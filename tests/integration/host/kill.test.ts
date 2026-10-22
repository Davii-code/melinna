import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makePaths } from '../../../src/core/paths';
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

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exitOf(c: Awaited<ReturnType<TestHost['connect']>>, execId: string) {
  for (let i = 0; i < 200; i++) {
    const p = (await c.list()).find((x) => x.execId === execId);
    if (p && !p.alive) return p;
    await sleep(50);
  }
  throw new Error('não saiu');
}

describe('kill', () => {
  it('sends Ctrl+C and the agent exits gracefully', async () => {
    const c = await th.connect();
    const col = collector();
    await c.spawn(fakeSpawn('k1', cwd));
    await c.attach('k1', 0, col.sink);
    await col.waitFor('pronto');
    const started = Date.now();
    await c.kill('k1', { graceMs: 5000 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await exitOf(c, 'k1')).exitCode).toBe(130);
  });

  it('sends a second Ctrl+C for agents that ask to confirm, so they exit gracefully', async () => {
    const c = await th.connect();
    const col = collector();
    await c.spawn(fakeSpawn('k3', cwd));
    await c.attach('k3', 0, col.sink);
    await col.waitFor('pronto');
    c.write('k3', enc('double-ctrl-c\r'));
    await col.waitFor('double-ctrl-c');
    const started = Date.now();
    await c.kill('k3', { graceMs: 5000 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await exitOf(c, 'k3')).exitCode).toBe(130);
    expect(col.text()).toContain('press-ctrl-c-again');
  });

  it('forces the tree (agent and grandchild) after graceMs when Ctrl+C is ignored', async () => {
    const c = await th.connect();
    const col = collector();
    const { pid } = await c.spawn(fakeSpawn('k2', cwd));
    await c.attach('k2', 0, col.sink);
    await col.waitFor('pronto');
    c.write('k2', enc('ignore-sigint\r'));
    await col.waitFor('ignoring-sigint');
    c.write('k2', enc('spawn-child\r'));
    const text = await col.waitFor(/child=\d+/);
    const child = Number(/child=(\d+)/.exec(text)?.[1]);
    expect(alive(child)).toBe(true);
    const started = Date.now();
    await c.kill('k2', { graceMs: 500 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
    await exitOf(c, 'k2');
    await sleep(200);
    expect(alive(pid)).toBe(false);
    expect(alive(child)).toBe(false);
  });

  it('refuses to kill an execution that is not from this host, touching no pid', async () => {
    const c = await th.connect();
    await expect(c.kill('de-outro-hospedeiro', { graceMs: 100 })).rejects.toMatchObject({
      code: 'EXECUTION_NOT_RUNNING',
    });
  });

  it('shutdown stops everything, writes the scrollback and exits', async () => {
    const c = await th.connect();
    const col = collector();
    await c.spawn(fakeSpawn('s1', cwd));
    await c.spawn(fakeSpawn('s2', cwd));
    await c.attach('s1', 0, col.sink);
    await col.waitFor('pronto');
    await sleep(300);
    await c.shutdown(1000);
    for (let i = 0; i < 50 && th.exits.length === 0; i++) await sleep(50);
    expect(th.exits).toEqual([0]);
    const paths = makePaths(th.userData, currentOs);
    for (const id of ['s1', 's2']) {
      const dir = paths.scrollbackDir(id);
      const segs = readdirSync(dir).filter((f) => f.endsWith('.seg'));
      const content = segs.map((s) => readFileSync(join(dir, s), 'utf8')).join('');
      expect(content).toContain('pronto');
    }
  });
});
