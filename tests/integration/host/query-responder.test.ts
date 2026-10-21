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

/**
 * No Windows o ConPTY emula o terminal e responde à consulta de posição do cursor (DSR 6) por conta
 * própria, antes do hospedeiro ou de qualquer painel. Quem responde deixa de ser observável pelo
 * agente; o que continua observável — e é o que importa para o usuário — é que o agente recebe uma
 * resposta e não trava esperando. A divisão entre "hospedeiro responde" e "o xterm do painel
 * responde" é coberta pelo teste unitário de `TerminalQueryResponder`/`hostShouldRespond`.
 */
describe('terminal queries', () => {
  it('never leaves the agent waiting for a cursor position when no panel is attached', async () => {
    const c = await th.connect();
    await c.spawn(fakeSpawn('q1', cwd, [], { cols: 80, rows: 33 }));
    c.write('q1', enc('query-cursor\r'));
    const col = collector();
    await new Promise((r) => setTimeout(r, 800));
    await c.attach('q1', 0, col.sink);
    await col.waitFor(/cpr=\d+;\d+/);
    expect(col.text()).not.toContain('cpr=timeout');
  });
});
