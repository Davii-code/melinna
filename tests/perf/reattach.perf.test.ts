import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MarkerKind } from '../../src/core/contracts/host-protocol';
import { collector, enc, fakeSpawn, sleep, startTestHost, type TestHost } from '../support/host-harness';

let th: TestHost;
let cwd: string;
const ids = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];

beforeAll(async () => {
  th = await startTestHost();
  cwd = mkdtempSync(join(tmpdir(), 'melinna-perf-'));
  const c = await th.connect();
  for (const id of ids) {
    const col = collector();
    await c.spawn(fakeSpawn(id, cwd));
    const detach = await c.attach(id, 0, col.sink);
    await col.waitFor('pronto');
    await detach();
    c.write(id, enc('flood 9\r'));
  }
  // espera o histórico de todas chegar ao limite de 8 MB
  for (let i = 0; i < 600; i++) {
    const list = await c.list();
    if (list.filter((p) => ids.includes(p.execId)).every((p) => p.totalBytes >= 9 * 1024 * 1024)) break;
    await sleep(100);
  }
  await sleep(500);
  c.close();
}, 120_000);

afterAll(async () => {
  await th.cleanup();
  rmSync(cwd, { recursive: true, force: true });
});

describe('SC-004', () => {
  it('reattaching 6 executions with 8 MB of history each takes ≤ 2 s', async () => {
    const c = await th.connect();
    const started = performance.now();
    const sizes = await Promise.all(
      ids.map(
        (id) =>
          new Promise<number>((resolve, reject) => {
            let bytes = 0;
            c.attach(id, 0, {
              onData: (_o, b) => {
                bytes += b.length;
              },
              onMarker: (k: MarkerKind) => {
                if (k === 'replay-end') resolve(bytes);
              },
            }).catch(reject);
          }),
      ),
    );
    const elapsed = performance.now() - started;
    console.log(
      `SC-004: ${Math.round(elapsed)} ms para reanexar 6 × ${(sizes[0]! / 1024 / 1024).toFixed(1)} MB`,
    );
    for (const s of sizes) {
      // 3 segmentos cheios mais o atual: entre 6 e 8 MB
      expect(s).toBeGreaterThan(6 * 1024 * 1024);
      expect(s).toBeLessThanOrEqual(8 * 1024 * 1024);
    }
    expect(elapsed).toBeLessThanOrEqual(2000);
  });
});
