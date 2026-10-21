import { existsSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../../../src/adapters/node-fs';
import { NodeProcessRunner } from '../../../../src/adapters/node-process-runner';
import { DiffService } from '../../../../src/core/git/diff';
import { GitRunner } from '../../../../src/core/git/git-runner';
import type { Execution } from '../../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../../support/execution-harness';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { MemoryLogger } from '../../../support/fakes/logger';
import { collector, enc, sleep } from '../../../support/host-harness';
import { currentOs } from '../../../support/os';
import { removeDirRecursive } from '../../../support/temp-dirs';

let h: CoreHarness;
let repo: TempRepo;
let plain: string;

beforeEach(async () => {
  h = await createCoreHarness();
  repo = createTempRepo({ files: { 'src/app.ts': 'export {}\n' } });
  plain = realpathSync(mkdtempSync(join(tmpdir(), 'melinna-pasta-')));
  writeFileSync(join(plain, 'notas.txt'), 'oi\n');
});

afterEach(async () => {
  await h.cleanup();
  repo.cleanup();
  removeDirRecursive(plain);
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

async function launchDirect(folder: string): Promise<Execution> {
  const ws = await h.workspace.openWorkspace(folder);
  const task = await h.workspace.createTask({
    groupId: ws.id,
    repoPath: ws.repoPath ?? folder,
    baseRef: 'HEAD',
    prompt: '',
    isolation: 'direct',
  });
  const [r] = await h.executions.launch(task.id, [{ agentId: 'fake' }], SIZE);
  expect(r?.ok).toBe(true);
  return h.model.executionsOf(task.id)[0]!;
}

async function cwdOf(e: Execution): Promise<string> {
  const col = collector();
  await h.executions.attach(e.id, col.sink);
  await col.waitFor('pronto');
  h.executions.write(e.id, enc('/cwd\r'));
  await col.waitFor(/cwd=.*\r\n/);
  return /cwd=(.*)\r\n/.exec(col.text())![1]!;
}

describe('execução direta na pasta', () => {
  it('runs in a folder outside git, with no worktree, and removal keeps the folder', async () => {
    const e = await launchDirect(plain);
    expect(e.worktreePath).toBe(plain);
    expect(exec(e.id).branch).toBe('');
    expect(realpathSync(await cwdOf(e))).toBe(plain);
    expect(existsSync(join(h.userData, 'worktrees'))).toBe(false);
    expect(await h.executions.removalCheck(e.id)).toEqual({
      uncommittedFiles: 0,
      unmergedCommits: 0,
      branch: '',
    });
    expect(await h.executions.divergence(e.id)).toEqual({ baseAdvancedBy: 0 });
    expect(await h.executions.removeTask(e.taskId).catch((err: { code: string }) => err.code)).toBe(
      'EXECUTION_RUNNING',
    );
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await h.executions.removeTask(e.taskId);
    expect(h.model.execution(e.id)).toBeUndefined();
    expect(h.model.task(e.taskId)).toBeUndefined();
    expect(existsSync(join(plain, 'notas.txt'))).toBe(true);
  });

  it('relaunches in the same folder', async () => {
    const e = await launchDirect(plain);
    await waitStatus(e.id, ['running', 'idle']);
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await h.executions.relaunch(e.id, SIZE);
    await waitStatus(e.id, ['running', 'idle']);
    expect(exec(e.id).launchCount).toBe(2);
    expect(realpathSync(await cwdOf(exec(e.id)))).toBe(plain);
  });

  it('runs in the repository itself, creates no branch and removal keeps uncommitted changes', async () => {
    const e = await launchDirect(repo.root);
    expect(realpathSync(await cwdOf(e))).toBe(realpathSync(repo.root));
    writeFileSync(join(repo.root, 'src', 'app.ts'), 'export const x = 1;\n');
    expect((await h.executions.removalCheck(e.id)).branch).toBe('');
    const branches = git(repo.root, ['branch', '--format=%(refname:short)']).trim().split('\n');
    expect(branches).toEqual(['main']);
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await h.executions.remove(e.id, { deleteBranch: false, force: false });
    expect(git(repo.root, ['status', '--porcelain'])).toContain('src/app.ts');
  });

  it('diffs the folder against HEAD inside git and returns an empty diff outside git', async () => {
    const log = new MemoryLogger();
    const diffs = new DiffService({
      git: new GitRunner(new NodeProcessRunner(), log),
      fs: new NodeFileSystem(),
      os: currentOs,
      log,
      model: h.model,
    });
    const inRepo = await launchDirect(repo.root);
    writeFileSync(join(repo.root, 'src', 'app.ts'), 'export const x = 1;\n');
    const result = await diffs.diff(inRepo.id);
    expect(result.files.map((f) => f.path)).toEqual(['src/app.ts']);
    const outside = await launchDirect(plain);
    expect(await diffs.diff(outside.id)).toEqual({ files: [] });
    await h.executions.stopAll(1000);
  });
});
