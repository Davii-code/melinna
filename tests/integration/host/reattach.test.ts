import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeClock } from '../../../src/adapters/node-clock';
import { makePaths } from '../../../src/core/paths';
import type { MarkerKind } from '../../../src/core/contracts/host-protocol';
import type { PtyExit, PtyFactory, PtyProcess } from '../../../src/host/node-pty-adapter';
import { PtySupervisor } from '../../../src/host/pty-supervisor';
import { MemoryFileSystem } from '../../support/fakes/file-system';
import { MemoryLogger } from '../../support/fakes/logger';
import { collector, enc, fakeSpawn, sleep, startTestHost, type TestHost } from '../../support/host-harness';
import { currentOs } from '../../support/os';

let th: TestHost;
let cwd: string;
beforeEach(async () => {
  th = await startTestHost();
  cwd = mkdtempSync(join(tmpdir(), 'melinna-cwd-'));
});
afterEach(async () => {
  await th.cleanup();
  rmSync(cwd, { recursive: true, force: true });
});

describe('reattach', () => {
  it('attach from zero gets replay-start, history, replay-end, then live output with contiguous offsets', async () => {
    const a = await th.connect();
    const first = collector();
    await a.spawn(fakeSpawn('r1', cwd));
    await a.attach('r1', 0, first.sink);
    await first.waitFor('pronto');
    a.write('r1', enc('primeira\r'));
    await first.waitFor('echo:primeira');

    const b = await th.connect();
    const events: string[] = [];
    const second = collector();
    const sink = {
      onData: (o: number, bytes: Uint8Array) => {
        events.push('data');
        second.sink.onData(o, bytes);
      },
      onMarker: (k: MarkerKind) => {
        events.push(k);
        second.sink.onMarker(k);
      },
    };
    await b.attach('r1', 0, sink);
    expect(events[0]).toBe('replay-start');
    expect(events.indexOf('replay-end')).toBeGreaterThan(0);
    expect(second.text()).toContain('echo:primeira');
    b.write('r1', enc('segunda\r'));
    await second.waitFor('echo:segunda');
    expect(events.at(-1)).toBe('data');
    for (let i = 1; i < second.offsets.length; i++) {
      expect(second.offsets[i]!.offset).toBe(second.offsets[i - 1]!.offset + second.offsets[i - 1]!.length);
    }
    expect(second.text().match(/echo:primeira/g)).toHaveLength(1);
  });

  it('dropping the client and reattaching from the last offset neither duplicates nor loses bytes', async () => {
    const a = await th.connect();
    const col = collector();
    await a.spawn(fakeSpawn('r2', cwd));
    await a.attach('r2', 0, col.sink);
    await col.waitFor('pronto');
    const lastOffset = col.bytes();
    a.close();
    await sleep(100);
    const writer = await th.connect();
    writer.write('r2', enc('durante a queda\r'));
    await sleep(300);
    const b = await th.connect();
    const rest = collector();
    await b.attach('r2', lastOffset, rest.sink);
    expect(rest.offsets[0]?.offset).toBe(lastOffset);
    expect(rest.text()).toContain('echo:durante a queda');
    expect(rest.text()).not.toContain('pronto');
    expect(col.text() + rest.text()).toMatch(/pronto[\s\S]*echo:durante a queda/);
  });

  it('a process that exits without a client stays in the registry with code and time, and list reflects it', async () => {
    const a = await th.connect();
    await a.spawn(fakeSpawn('r3', cwd));
    await sleep(300);
    a.write('r3', enc('exit 5\r'));
    for (let i = 0; i < 100; i++) {
      const p = (await a.list()).find((x) => x.execId === 'r3');
      if (p && !p.alive) break;
      await sleep(50);
    }
    const info = (await a.list()).find((x) => x.execId === 'r3');
    expect(info).toMatchObject({ alive: false, exitCode: 5 });
    expect(info?.endedAt).toMatch(/^\d{4}-/);
    await sleep(100);
    const reg = JSON.parse(readFileSync(makePaths(th.userData, currentOs).hostRegistry, 'utf8')) as {
      processes: Record<string, { exitCode: number; endedAt: string; totalBytes: number }>;
    };
    expect(reg.processes.r3).toMatchObject({ exitCode: 5 });
    expect(reg.processes.r3?.endedAt).toBe(info?.endedAt);
    expect(reg.processes.r3?.totalBytes).toBeGreaterThan(0);
    const late = collector();
    await (await th.connect()).attach('r3', 0, late.sink);
    expect(late.text()).toContain('pronto');
  });
});

/** PTY falso: emite saída sob comando, para controlar o instante exato de uma consulta. */
class ScriptedPty implements PtyProcess {
  readonly pid = 4321;
  written: string[] = [];
  private dataFn: ((d: Uint8Array) => void) | undefined;
  onData(cb: (d: Uint8Array) => void) {
    this.dataFn = cb;
  }
  onExit(_cb: (e: PtyExit) => void) {}
  write(d: Uint8Array) {
    this.written.push(new TextDecoder().decode(d));
  }
  resize() {}
  pause() {}
  resume() {}
  kill() {}
  emit(s: string) {
    this.dataFn?.(enc(s));
  }
}

describe('terminal query during replay', () => {
  it('is answered by the host even with another connection attached', async () => {
    const pty = new ScriptedPty();
    const factory: PtyFactory = { spawn: () => pty };
    const fs = new MemoryFileSystem();
    const ud = mkdtempSync(join(tmpdir(), 'melinna-ud-'));
    const paths = makePaths(ud, currentOs);
    fs.seed(join(paths.scrollbackRoot, '.keep'), '');
    let duringRead: (() => void) | null = null;
    const original = fs.readFile.bind(fs);
    fs.readFile = async (p: string) => {
      duringRead?.();
      duringRead = null;
      return original(p);
    };
    const sup = new PtySupervisor({
      ptyFactory: factory,
      fs,
      paths,
      clock: new NodeClock(),
      log: new MemoryLogger(),
      events: {
        exit: () => undefined,
        activity: () => undefined,
        scrollbackStatus: () => undefined,
        changed: () => undefined,
      },
    });
    try {
      await sup.spawn({ ...fakeSpawn('q', ud), file: process.execPath, rows: 40 });
      pty.emit('histórico antigo\r\n');
      const live = { output: () => undefined, marker: () => undefined };
      await sup.attach('q', 0, live);
      pty.written = [];
      // com uma conexão anexada ao vivo, fora da reprodução o hospedeiro não responde
      pty.emit('\x1b[6n');
      expect(pty.written).toEqual([]);
      // durante a reprodução de outra conexão, responde
      duringRead = () => pty.emit('\x1b[6n');
      await sup.attach('q', 0, { output: () => undefined, marker: () => undefined });
      expect(pty.written).toEqual(['\x1b[40;1R']);
    } finally {
      rmSync(ud, { recursive: true, force: true });
    }
  });
});
