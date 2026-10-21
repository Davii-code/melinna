import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FrameDecoder, encodeFrame } from '../../../src/core/contracts/frame-codec';
import { MelinnaError } from '../../../src/core/errors';
import { NodeHostClient } from '../../../src/main/host-client';
import { MemoryLogger } from '../../support/fakes/logger';
import { collector, enc, fakeSpawn, sleep, startTestHost, type TestHost } from '../../support/host-harness';

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

function rawConnect(
  endpoint: string,
): Promise<{ frames: unknown[]; closed: Promise<void>; send: (h: object) => void }> {
  return new Promise((resolve) => {
    const s = createConnection(endpoint);
    const dec = new FrameDecoder();
    const frames: unknown[] = [];
    const closed = new Promise<void>((r) => s.on('close', () => r()));
    s.on('data', (c: Buffer) => frames.push(...dec.push(new Uint8Array(c)).map((f) => f.header)));
    s.on('error', () => undefined);
    s.on('connect', () => resolve({ frames, closed, send: (h) => s.write(encodeFrame(h)) }));
  });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as MelinnaError).code;
  }
  return 'none';
}

describe('host handshake', () => {
  it('welcomes a client with the right token', async () => {
    const c = await th.connect();
    expect(c.hostPid).toBe(process.pid);
    expect(await c.list()).toEqual([]);
  });

  it('rejects a wrong token with HOST_AUTH and closes', async () => {
    expect(await code(NodeHostClient.connect(th.host.endpoint, 'f'.repeat(64), new MemoryLogger()))).toBe(
      'HOST_AUTH',
    );
  });

  it('rejects a different protocol version with HOST_VERSION', async () => {
    const raw = await rawConnect(th.host.endpoint);
    raw.send({ t: 'hello', protocolVersion: 99, token: th.token });
    await raw.closed;
    expect(raw.frames[0]).toMatchObject({ t: 'error', code: 'HOST_VERSION', supported: 1 });
  });

  it('closes a connection that does not say hello within 2 s', async () => {
    const raw = await rawConnect(th.host.endpoint);
    const started = Date.now();
    await raw.closed;
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(raw.frames).toEqual([]);
  });

  it('rejects requests before the handshake', async () => {
    const raw = await rawConnect(th.host.endpoint);
    raw.send({ t: 'list', id: 1 });
    await raw.closed;
    expect(raw.frames[0]).toMatchObject({ t: 'error', code: 'HOST_AUTH' });
  });
});

describe('host spawn and I/O', () => {
  it('refuses relative files and .cmd/.bat files', async () => {
    const c = await th.connect();
    expect(await code(c.spawn({ ...fakeSpawn('r', cwd), file: 'node' }))).toBe('UNSAFE_LAUNCHER');
    expect(await code(c.spawn({ ...fakeSpawn('c', cwd), file: join(cwd, 'agent.cmd') }))).toBe(
      'UNSAFE_LAUNCHER',
    );
    expect(await code(c.spawn({ ...fakeSpawn('b', cwd), file: join(cwd, 'AGENT.BAT') }))).toBe(
      'UNSAFE_LAUNCHER',
    );
    expect(await code(c.spawn({ ...fakeSpawn('m', cwd), file: join(cwd, 'missing') }))).toBe(
      'EXECUTABLE_NOT_FOUND',
    );
  });

  it('spawns, echoes input with colors and reports the exit code', async () => {
    const c = await th.connect();
    const col = collector();
    const exits: unknown[] = [];
    c.on('exit', (e) => exits.push(e));
    const { pid } = await c.spawn(fakeSpawn('e1', cwd, ['--model', 'x'], { cols: 200, rows: 40 }));
    expect(pid).toBeGreaterThan(0);
    await c.attach('e1', 0, col.sink);
    await col.waitFor('pronto');
    const text = col.text();
    expect(text).toContain('["--model","x"]');
    // O ConPTY pode quebrar a linha entre a sequência de cor e o texto ao redesenhar a tela, então
    // o que se verifica é a cor vir antes do texto, não a adjacência byte a byte.
    expect(text.indexOf('\x1b[32m')).toBeGreaterThan(-1);
    expect(text.indexOf('\x1b[32m')).toBeLessThan(text.indexOf('pronto'));
    c.write('e1', enc('olá mundo\r'));
    await col.waitFor('echo:olá mundo');
    c.write('e1', enc('exit 7\r'));
    await sleep(50);
    for (let i = 0; i < 100 && exits.length === 0; i++) await sleep(50);
    expect(exits[0]).toMatchObject({ execId: 'e1', exitCode: 7, signal: null });
    expect((await c.list())[0]).toMatchObject({ execId: 'e1', alive: false, exitCode: 7 });
  });

  it('applies resize within limits and ignores out-of-range sizes', async () => {
    const c = await th.connect();
    const col = collector();
    await c.spawn(fakeSpawn('rs', cwd, [], { cols: 100, rows: 30 }));
    await c.attach('rs', 0, col.sink);
    await col.waitFor('size=100x30');
    c.resize('rs', 10, 3);
    c.resize('rs', 2000, 30);
    c.resize('rs', 120, 40);
    await col.waitFor('size=120x40');
    expect(col.text()).not.toContain('size=10x3');
    expect(col.text()).not.toContain('size=2000x30');
  });

  it('emits activity at most every 250 ms per execution', async () => {
    const c = await th.connect();
    const col = collector();
    const times: number[] = [];
    c.on('activity', (e) => {
      if (e.execId === 'act') times.push(Date.now());
    });
    await c.spawn(fakeSpawn('act', cwd));
    await c.attach('act', 0, col.sink);
    await col.waitFor('pronto');
    c.write('act', enc('/busy 1500\r'));
    await col.waitFor('busy-done', 5000);
    await sleep(300);
    expect(times.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(200);
  });
});
