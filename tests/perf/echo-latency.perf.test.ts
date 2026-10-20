import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemNode } from '../support/fake-catalog';
import { collector, enc, startTestHost, type TestHost } from '../support/host-harness';

let th: TestHost;
let cwd: string;
beforeAll(async () => {
  th = await startTestHost();
  cwd = mkdtempSync(join(tmpdir(), 'melinna-perf-'));
});
afterAll(async () => {
  await th.cleanup();
  rmSync(cwd, { recursive: true, force: true });
});

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? Infinity;
}

describe('SC-002 (principal ↔ hospedeiro)', () => {
  it('p95 of the echo of 1,000 keystrokes is ≤ 30 ms', async () => {
    const c = await th.connect();
    // processo em modo canônico: o eco é da disciplina de linha do PTY, então mede só o trajeto do app
    const id = 'echo';
    await c.spawn({
      execId: id,
      file: systemNode(),
      args: ['-e', 'process.stdin.resume(); setInterval(() => {}, 1e6)'],
      cwd,
      env: process.env as Record<string, string>,
      cols: 120,
      rows: 30,
    });
    let received = 0;
    let waiter: (() => void) | null = null;
    const col = collector((_o, bytes) => {
      received += bytes.length;
      waiter?.();
    });
    await c.attach(id, 0, col.sink);
    await new Promise((r) => setTimeout(r, 300));
    const samples: number[] = [];
    const keys = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 1000; i++) {
      const before = received;
      const t0 = performance.now();
      const echoed = new Promise<void>((resolve) => {
        waiter = () => {
          if (received > before) resolve();
        };
      });
      c.write(id, enc(keys[i % keys.length]!));
      await echoed;
      samples.push(performance.now() - t0);
      if (i % 100 === 99) c.write(id, enc('\x15'));
    }
    const value = p95(samples);
    console.log(`SC-002: p95 ${value.toFixed(2)} ms em ${samples.length} teclas`);
    expect(value).toBeLessThanOrEqual(30);
  });
});
