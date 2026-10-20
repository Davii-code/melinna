import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collector, enc, fakeSpawn, startTestHost, type TestHost } from '../../support/host-harness';

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

describe('terminal queries', () => {
  it('the host answers a cursor query when no connection is attached', async () => {
    const c = await th.connect();
    await c.spawn(fakeSpawn('q1', cwd, [], { cols: 80, rows: 33 }));
    // sem attach: a consulta é feita e respondida com o painel fechado
    c.write('q1', enc('query-cursor\r'));
    const col = collector();
    await new Promise((r) => setTimeout(r, 800));
    await c.attach('q1', 0, col.sink);
    await col.waitFor(/cpr=33;1/);
    expect(col.text()).not.toContain('cpr=timeout');
  });

  it('with a connection attached the host stays silent and the client reply reaches the agent', async () => {
    const c = await th.connect();
    const col = collector();
    await c.spawn(fakeSpawn('q2', cwd, [], { cols: 80, rows: 24 }));
    await c.attach('q2', 0, col.sink);
    await col.waitFor('pronto');
    c.write('q2', enc('query-cursor\r'));
    await col.waitFor('\x1b[6n');
    // o "xterm" do cliente responde com outra posição
    c.write('q2', enc('\x1b[7;9R'));
    await col.waitFor(/cpr=7;9/);
    expect(col.text()).not.toContain('cpr=24;1');
  });
});
