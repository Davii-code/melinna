import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collector, fakeSpawn, sleep, startTestHost, type TestHost } from '../../support/host-harness';

const dirs: string[] = [];
const hosts: TestHost[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.cleanup();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('new host after a crash', () => {
  it('does not adopt pids from the previous registry and relaunch continues offsets from meta.json', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'melinna-restart-'));
    const cwd = mkdtempSync(join(tmpdir(), 'melinna-cwd-'));
    dirs.push(userData, cwd);

    const first = await startTestHost({ userData });
    const a = await first.connect();
    const col = collector();
    await a.spawn(fakeSpawn('e1', cwd));
    await a.attach('e1', 0, col.sink);
    await col.waitFor('pronto');
    const oldBytes = col.bytes();
    // queda: o hospedeiro some com o processo
    await first.host.supervisor.shutdown(200);
    await first.host.stop();
    a.close();

    const second = await startTestHost({ userData });
    hosts.push(second);
    const b = await second.connect();
    expect(await b.list()).toEqual([]);

    const history = collector();
    await b.attach('e1', 0, history.sink);
    expect(history.text()).toContain('pronto');
    expect(history.bytes()).toBeGreaterThanOrEqual(oldBytes);
    const historyEnd = history.bytes();

    const live = collector();
    await b.spawn({ ...fakeSpawn('e1', cwd), separator: '\r\n── relançado ──\r\n' });
    await b.attach('e1', historyEnd, live.sink);
    await live.waitFor('pronto');
    expect(live.offsets[0]?.offset).toBe(historyEnd);
    expect(live.text().startsWith('\r\n── relançado ──')).toBe(true);
    await sleep(100);
    const all = collector();
    await b.attach('e1', 0, all.sink);
    expect(all.text().match(/pronto/g)).toHaveLength(2);
    expect(all.text().indexOf('relançado')).toBeGreaterThan(all.text().indexOf('pronto'));
  });
});
