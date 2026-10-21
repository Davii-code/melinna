import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Execution } from '../../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../../support/execution-harness';
import { fakeCatalogJson } from '../../../support/fake-catalog';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { collector, enc, sleep } from '../../../support/host-harness';
import {
  expectMainTreeUnchanged,
  snapshotMainTree,
  type MainTreeSnapshot,
} from '../../../support/main-tree-invariant';

let h: CoreHarness;
let repo: TempRepo;
let snap: MainTreeSnapshot;

beforeEach(async () => {
  h = await createCoreHarness();
  repo = createTempRepo({ files: { 'src/app.ts': 'export {}\n' } });
  snap = snapshotMainTree(repo.root);
});

afterEach(async () => {
  expectMainTreeUnchanged(repo.root, snap);
  await h.cleanup();
  repo.cleanup();
});

async function newTask(prompt: string) {
  const g = await h.workspace.createGroup('Grupo');
  return h.workspace.createTask({ groupId: g.id, repoPath: repo.root, baseRef: 'main', prompt });
}

function exec(id: string): Execution {
  const e = h.model.execution(id);
  if (!e) throw new Error(`sem execução ${id}`);
  return e;
}

async function waitStatus(id: string, statuses: string[], timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!statuses.includes(exec(id).status)) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`status ${exec(id).status}, esperado ${statuses.join('|')}`);
    await sleep(25);
  }
}

describe('ExecutionService.launch', () => {
  it('creates one worktree and one process per pick, each worktree before its spawn, and converses', async () => {
    const task = await newTask('Implemente a busca');
    const spawnSeen: { execId: string; worktreeExisted: boolean }[] = [];
    const results = await h.executions.launch(
      task.id,
      [{ agentId: 'fake' }, { agentId: 'fake', model: 'esperto' }, { agentId: 'fake-pty' }],
      { cols: 100, rows: 30 },
    );
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    const execs = h.model.executionsOf(task.id);
    expect(execs).toHaveLength(3);
    expect(new Set(execs.map((e) => e.branch)).size).toBe(3);
    expect(execs.map((e) => e.branch)).toEqual([
      'melinna/implemente-a-busca/fake',
      'melinna/implemente-a-busca/fake-2',
      'melinna/implemente-a-busca/fake-pty',
    ]);
    expect(execs.map((e) => e.bandIndex)).toEqual([0, 1, 2]);
    for (const e of execs) {
      expect(existsSync(e.worktreePath)).toBe(true);
      spawnSeen.push({ execId: e.id, worktreeExisted: existsSync(e.worktreePath) });
      expect(git(e.worktreePath, ['rev-parse', 'HEAD']).trim()).toBe(task.baseCommit);
      expect(e.pid).toBeGreaterThan(0);
      expect(['running', 'idle']).toContain(e.status);
    }
    expect(git(repo.root, ['worktree', 'list']).trim().split('\n')).toHaveLength(4);

    // conversa em cada painel
    for (const e of execs) {
      const col = collector();
      await h.executions.attach(e.id, col.sink);
      await col.waitFor('pronto');
      h.executions.write(e.id, enc(`oi ${e.bandIndex}\r`));
      await col.waitFor(`echo:oi ${e.bandIndex}`);
      h.executions.write(e.id, enc('de novo\r'));
      await col.waitFor('echo:de novo');
      if (e.agentId === 'fake') {
        expect(col.text()).toContain('"Implemente a busca"');
        expect(col.text()).toContain(
          e.model === 'esperto'
            ? '["--model","esperto","Implemente a busca"]'
            : '["--model","rapido","Implemente a busca"]',
        );
      } else {
        // enunciado por PTY: chega depois da primeira saída
        expect(col.text().indexOf('echo:Implemente a busca')).toBeGreaterThan(col.text().indexOf('pronto'));
        // O ConPTY moderno prefixa a sessão com sequências de controle antes da primeira linha do
        // agente; o que interessa aqui é a primeira linha do agente sair sem argumentos.
        const firstLine = col.text().split(/\r*\n/)[0].replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        expect(firstLine).toBe('[]');
      }
    }
    expect(spawnSeen.every((s) => s.worktreeExisted)).toBe(true);
  });

  it('delivers adversarial prompts intact as a single argument', async () => {
    const prompt =
      'aspas "duplas" \\"escapadas\\" \'simples\' %PATH% & | ^ < > $(echo x) `y`\nlinha2\ttab emoji 🚀 CJK 漢字 barra no fim\\';
    const task = await newTask(prompt);
    const [r] = await h.executions.launch(task.id, [{ agentId: 'fake' }], { cols: 120, rows: 30 });
    expect(r?.ok).toBe(true);
    const e = h.model.executionsOf(task.id)[0]!;
    const col = collector();
    await h.executions.attach(e.id, col.sink);
    await col.waitFor('pronto');
    // O ConPTY prefixa a sessão com sequências de controle na mesma primeira linha; removê-las deixa
    // só o JSON de argumentos que o agente falso imprime.
    const firstLine = col.text().split('\r\n')[0]!.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
    expect(JSON.parse(firstLine)).toEqual(['--model', 'rapido', prompt]);
  });

  it('a missing executable fails only that execution and keeps its worktree', async () => {
    const catalog = JSON.parse(fakeCatalogJson()) as {
      agents: { id: string; executable: { command: string } }[];
    };
    const gone = structuredClone(catalog.agents[0]!);
    gone.id = 'sumido';
    gone.executable.command = `${h.userData}/nao-existe/agente`;
    catalog.agents.push(gone);
    writeFileSync(h.paths.userCatalog, JSON.stringify(catalog));
    await h.catalog.load();
    const task = await newTask('tarefa');
    const results = await h.executions.launch(
      task.id,
      [{ agentId: 'fake' }, { agentId: 'sumido' }, { agentId: 'fake' }],
      { cols: 80, rows: 24 },
    );
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    const failedResult = results[1]!;
    expect(failedResult.ok === false && failedResult.error.code).toBe('EXECUTABLE_NOT_FOUND');
    const failedExec = h.model.executionsOf(task.id).find((e) => e.agentId === 'sumido')!;
    expect(failedExec.status).toBe('failed_to_start');
    expect(failedExec.failure?.message).toContain('não encontrado');
    expect(existsSync(failedExec.worktreePath)).toBe(true);
  });

  it('refuses invalid models before creating anything and records exits', async () => {
    const task = await newTask('t');
    const results = await h.executions.launch(
      task.id,
      [{ agentId: 'fake-resume', model: 'inventado' }, { agentId: 'fake' }],
      { cols: 80, rows: 24 },
    );
    expect(results[0]).toMatchObject({ ok: false, error: { code: 'INPUT_INVALID' } });
    const bad = h.model.executionsOf(task.id)[0]!;
    expect(bad.status).toBe('failed_to_start');
    expect(existsSync(bad.worktreePath)).toBe(false);
    expect(existsSync(h.paths.lease(task.repoId, bad.id))).toBe(false);
    const good = h.model.executionsOf(task.id)[1]!;
    const col = collector();
    await h.executions.attach(good.id, col.sink);
    await col.waitFor('pronto');
    h.executions.write(good.id, enc('exit 3\r'));
    await waitStatus(good.id, ['exited']);
    expect(exec(good.id)).toMatchObject({ exitCode: 3, pid: null });
    expect(h.executions.liveCount()).toBe(0);
  });

  it('never logs the prompt or typed input', async () => {
    const secret = 'SEGREDO-DO-ENUNCIADO-123';
    const task = await newTask(secret);
    await h.executions.launch(task.id, [{ agentId: 'fake' }, { agentId: 'fake-pty' }], {
      cols: 80,
      rows: 24,
    });
    const e = h.model.executionsOf(task.id)[0]!;
    const col = collector();
    await h.executions.attach(e.id, col.sink);
    await col.waitFor('pronto');
    h.executions.write(e.id, enc('TECLAS-SECRETAS-456\r'));
    await col.waitFor('echo:TECLAS-SECRETAS-456');
    await sleep(300);
    const hostLog = existsSync(h.paths.hostLog) ? readFileSync(h.paths.hostLog, 'utf8') : '';
    for (const text of [h.log.text(), hostLog]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain('TECLAS-SECRETAS');
    }
    expect(h.log.events()).toContain('execution.launched');
  });
});
