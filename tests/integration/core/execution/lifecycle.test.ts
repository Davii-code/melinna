import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isMelinnaError } from '../../../../src/core/errors';
import type { Execution } from '../../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../../support/execution-harness';
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

const SIZE = { cols: 100, rows: 30 };

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

async function launchOne(model = 'esperto'): Promise<Execution> {
  const g = await h.workspace.createGroup('Grupo');
  const task = await h.workspace.createTask({
    groupId: g.id,
    repoPath: repo.root,
    baseRef: 'main',
    prompt: 'Ajuste o app',
  });
  const [r] = await h.executions.launch(task.id, [{ agentId: 'fake', model }], SIZE);
  expect(r?.ok).toBe(true);
  const e = h.model.executionsOf(task.id)[0]!;
  const col = collector();
  await h.executions.attach(e.id, col.sink);
  await col.waitFor('pronto');
  return e;
}

async function errorOf(p: Promise<unknown>): Promise<{ code: string; details?: Record<string, unknown> }> {
  try {
    await p;
  } catch (err) {
    if (isMelinnaError(err)) return { code: err.code, details: err.details };
    throw err;
  }
  throw new Error('esperava erro');
}

function branches(): string[] {
  return git(repo.root, ['branch', '--format=%(refname:short)']).trim().split('\n');
}

describe('ciclo de vida da execução', () => {
  it('stop keeps the worktree and the lease', async () => {
    const e = await launchOne();
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    expect(existsSync(e.worktreePath)).toBe(true);
    expect(existsSync(h.paths.lease(h.model.task(e.taskId)!.repoId, e.id))).toBe(true);
    expect(await errorOf(h.executions.stop(e.id))).toMatchObject({ code: 'EXECUTION_NOT_RUNNING' });
  });

  it('relaunch reuses worktree, agent, model and mode, writes a separator and keeps the lease', async () => {
    const e = await launchOne('esperto');
    const leasePath = h.paths.lease(h.model.task(e.taskId)!.repoId, e.id);
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await h.executions.relaunch(e.id, SIZE);
    expect(await errorOf(h.executions.relaunch(e.id, SIZE))).toMatchObject({ code: 'EXECUTION_RUNNING' });
    await waitStatus(e.id, ['running', 'idle']);
    const after = exec(e.id);
    expect(after.worktreePath).toBe(e.worktreePath);
    expect(after.agentId).toBe('fake');
    expect(after.model).toBe('esperto');
    expect(after.permissionMode).toBe(e.permissionMode);
    expect(after.launchCount).toBe(2);
    expect(existsSync(leasePath)).toBe(true);
    const col = collector();
    await h.executions.attach(e.id, col.sink);
    await col.waitFor(/relançado em/);
    const text = col.text();
    expect(text.indexOf('relançado em')).toBeGreaterThan(text.indexOf('pronto'));
    expect(text).toContain('["--model","esperto","Ajuste o app"]');
    h.executions.write(e.id, enc('continua\r'));
    await col.waitFor('echo:continua');
  });

  it('refuses to remove a live execution', async () => {
    const e = await launchOne();
    expect(await errorOf(h.executions.remove(e.id, { deleteBranch: true, force: false }))).toMatchObject({
      code: 'EXECUTION_RUNNING',
    });
    expect(existsSync(e.worktreePath)).toBe(true);
  });

  it('removalCheck counts uncommitted files and commits missing from the base', async () => {
    const e = await launchOne();
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    expect(await h.executions.removalCheck(e.id)).toEqual({
      uncommittedFiles: 0,
      unmergedCommits: 0,
      branch: e.branch,
    });
    writeFileSync(join(e.worktreePath, 'novo.txt'), 'x\n');
    writeFileSync(join(e.worktreePath, 'src/app.ts'), 'export const a = 1;\n');
    expect((await h.executions.removalCheck(e.id)).uncommittedFiles).toBe(2);
    git(e.worktreePath, ['add', '-A']);
    git(e.worktreePath, ['commit', '-q', '-m', 'trabalho do agente']);
    writeFileSync(join(e.worktreePath, 'mais.txt'), 'y\n');
    git(e.worktreePath, ['add', '-A']);
    git(e.worktreePath, ['commit', '-q', '-m', 'mais trabalho']);
    expect(await h.executions.removalCheck(e.id)).toEqual({
      uncommittedFiles: 0,
      unmergedCommits: 2,
      branch: e.branch,
    });
  });

  it('refuses to lose work without force and removes nothing', async () => {
    const e = await launchOne();
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    writeFileSync(join(e.worktreePath, 'novo.txt'), 'x\n');
    const err = await errorOf(h.executions.remove(e.id, { deleteBranch: false, force: false }));
    expect(err.code).toBe('WORK_WOULD_BE_LOST');
    expect(err.details).toMatchObject({ uncommittedFiles: 1, unmergedCommits: 0 });
    expect(existsSync(e.worktreePath)).toBe(true);
    expect(h.model.execution(e.id)).toBeDefined();

    git(e.worktreePath, ['add', '-A']);
    git(e.worktreePath, ['commit', '-q', '-m', 'trabalho']);
    // manter a branch preserva os commits: sem perda
    const keep = await errorOf(h.executions.remove(e.id, { deleteBranch: true, force: false }));
    expect(keep.code).toBe('WORK_WOULD_BE_LOST');
    expect(keep.details).toMatchObject({ uncommittedFiles: 0, unmergedCommits: 1 });
    await h.executions.remove(e.id, { deleteBranch: false, force: false });
    expect(existsSync(e.worktreePath)).toBe(false);
    expect(branches()).toContain(e.branch);
  });

  it('force removes worktree, branch, lease and scrollback', async () => {
    const e = await launchOne();
    const task = h.model.task(e.taskId)!;
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    writeFileSync(join(e.worktreePath, 'novo.txt'), 'x\n');
    git(e.worktreePath, ['add', '-A']);
    git(e.worktreePath, ['commit', '-q', '-m', 'trabalho']);
    writeFileSync(join(e.worktreePath, 'sujo.txt'), 'z\n');
    await h.executions.remove(e.id, { deleteBranch: true, force: true });
    expect(existsSync(e.worktreePath)).toBe(false);
    expect(existsSync(h.paths.lease(task.repoId, e.id))).toBe(false);
    expect(existsSync(h.paths.scrollbackDir(e.id))).toBe(false);
    expect(branches()).not.toContain(e.branch);
    expect(git(repo.root, ['worktree', 'list', '--porcelain'])).not.toContain(e.id);
    expect(h.model.execution(e.id)).toBeUndefined();
  });

  it('removes a clean execution deleting the branch and drops it from the layout', async () => {
    const e = await launchOne();
    h.model.mutate((s) => {
      s.layout.openExecutionIds = [e.id];
      s.layout.focusedExecutionId = e.id;
      s.layout.custom.cells[e.id] = { col: 0, row: 0, colSpan: 1, rowSpan: 1 };
    });
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await h.executions.remove(e.id, { deleteBranch: true, force: false });
    expect(existsSync(e.worktreePath)).toBe(false);
    expect(branches()).not.toContain(e.branch);
    const layout = h.model.snapshot().layout;
    expect(layout.openExecutionIds).not.toContain(e.id);
    expect(layout.focusedExecutionId).toBeNull();
    expect(layout.custom.cells[e.id]).toBeUndefined();
  });
});
