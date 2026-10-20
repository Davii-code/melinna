import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HIGH_WATER } from '../../../src/host/flow-control';
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

async function stable(get: () => number, ms = 600): Promise<number> {
  let last = get();
  for (;;) {
    await sleep(ms);
    const now = get();
    if (now === last) return now;
    last = now;
  }
}

describe('flow control', () => {
  it('stops delivering above 1 MB unacked, resumes on ack and delivers every byte in order', async () => {
    const c = await th.connect();
    const col = collector();
    await c.spawn(fakeSpawn('f1', cwd));
    await c.attach('f1', 0, col.sink);
    await col.waitFor('pronto');
    c.ack('f1', col.bytes());
    c.write('f1', enc('flood 20\r'));
    const stalled = await stable(() => col.bytes());
    // pausa logo após passar da marca alta (mais o que já estava em trânsito no PTY)
    expect(stalled).toBeGreaterThan(HIGH_WATER);
    expect(stalled).toBeLessThan(HIGH_WATER + 512 * 1024);
    // ack contínuo até o fim
    const done = (async () => {
      while (!col.text().includes('flood-done')) {
        c.ack('f1', col.bytes());
        await sleep(20);
      }
    })();
    await Promise.race([done, sleep(60_000)]);
    expect(col.text()).toContain('flood-done');
    const lines = col
      .text()
      .split(/\r*\n/)
      .filter((l) => /^\d{10} x+$/.test(l));
    expect(lines.length).toBeGreaterThan(300_000);
    lines.forEach((l, i) => expect(Number(l.slice(0, 10))).toBe(i));
    for (let i = 1; i < col.offsets.length; i++) {
      expect(col.offsets[i]!.offset).toBe(col.offsets[i - 1]!.offset + col.offsets[i - 1]!.length);
    }
  }, 90_000);

  it('never pauses without an attached connection and resumes when detaching', async () => {
    const c = await th.connect();
    const col = collector();
    const exits: number[] = [];
    c.on('exit', (e) => exits.push(e.exitCode ?? -1));
    await c.spawn(fakeSpawn('f2', cwd));
    const detach = await c.attach('f2', 0, col.sink);
    await col.waitFor('pronto');
    c.write('f2', enc('flood 4\r'));
    await stable(() => col.bytes());
    expect(col.text()).not.toContain('flood-done');
    await detach();
    // sem consumidor: a saída vai só para o histórico e o agente termina
    c.write('f2', enc('exit 0\r'));
    for (let i = 0; i < 200 && exits.length === 0; i++) await sleep(50);
    expect(exits).toEqual([0]);
    const all = collector();
    await c.attach('f2', 0, all.sink);
    expect(all.text()).toContain('flood-done');
  }, 60_000);
});
