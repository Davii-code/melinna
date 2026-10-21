import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { makePaths } from '../../../../src/core/paths';
import { emptyState, type Execution, type StateFile } from '../../../../src/core/persistence/state-schema';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { WorkspaceModel } from '../../../../src/core/workspace/workspace-model';
import { WorkspaceService } from '../../../../src/core/workspace/workspace-service';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner, ok } from '../../../support/fakes/process-runner';

const paths = makePaths('/data', 'linux');
const REPO_ID = 'abcdef0123456789';

function execution(id: string): Execution {
  return {
    id,
    taskId: 't1',
    agentId: 'fake',
    bandIndex: 0,
    model: null,
    permissionMode: null,
    branch: 'melinna/x/fake',
    worktreePath: paths.worktree(REPO_ID, id),
    baseCommit: 'b'.repeat(40),
    status: 'exited',
    pendingSwitch: null,
    pid: null,
    exitCode: 0,
    signal: null,
    startedAt: null,
    endedAt: null,
    launchCount: 1,
    failure: null,
  };
}

function setup(state: StateFile = emptyState()) {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const clock = new FakeClock(Date.parse('2026-02-03T04:05:06.000Z'));
  const log = new MemoryLogger();
  const store = new StateStore(fs, paths.state, clock, log);
  const model = new WorkspaceModel(state, store);
  const runner = new FakeProcessRunner()
    .on((_f, args) =>
      args.includes('list') && args.includes('worktree')
        ? ok(`worktree /repos/app\0worktree ${paths.worktree(REPO_ID, 'orfa')}\0`)
        : undefined,
    )
    .on(() => ok());
  const git = new GitRunner(runner, log);
  const svc = new WorkspaceService({
    model,
    git,
    clock,
    log,
    residue: { git, fs, mutex: new KeyedMutex(), os: 'linux', paths },
  });
  return { fs, clock, svc, model, runner, store };
}

function stateWithTask(executions: Execution[] = []): StateFile {
  const s = emptyState();
  s.groups.push({ id: 'g1', name: 'Grupo', order: 0 });
  s.tasks.push({
    id: 't1',
    groupId: 'g1',
    title: 'Tarefa',
    prompt: 'p',
    repoPath: '/repos/app',
    repoId: REPO_ID,
    baseRef: 'main',
    baseCommit: 'b'.repeat(40),
    slug: 'tarefa',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  s.executions.push(...executions);
  return s;
}

describe('WorkspaceService: renomear', () => {
  it('renames groups and tasks, trimming, and persists', async () => {
    const { svc, fs, clock, store } = setup(stateWithTask());
    await svc.renameGroup('g1', '  Frente B ');
    await svc.renameTask('t1', 'Novo título');
    expect(svc.snapshot().groups[0]?.name).toBe('Frente B');
    expect(svc.snapshot().tasks[0]?.title).toBe('Novo título');
    clock.advance(300);
    await store.flush();
    const saved = JSON.parse(fs.readText(paths.state)) as StateFile;
    expect(saved.groups[0]?.name).toBe('Frente B');
    expect(saved.tasks[0]?.title).toBe('Novo título');
  });

  it('validates sizes, line breaks and ids', async () => {
    const { svc } = setup(stateWithTask());
    await expect(svc.renameGroup('g1', '')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.renameGroup('g1', 'a\nb')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.renameGroup('g1', 'x'.repeat(81))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.renameGroup('nao', 'ok')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.renameTask('t1', 'x'.repeat(121))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.renameTask('t1', 'a\rb')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.renameTask('nao', 'ok')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(svc.snapshot().groups[0]?.name).toBe('Grupo');
    expect(svc.snapshot().tasks[0]?.title).toBe('Tarefa');
  });
});

describe('WorkspaceService: limpar resíduo', () => {
  it('refuses paths outside the worktrees folder', async () => {
    const { svc, runner } = setup(stateWithTask());
    await expect(svc.cleanResidue('/repos/app')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.cleanResidue(`${paths.worktreesRoot}/../state.json`)).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(runner.calls).toHaveLength(0);
  });

  it('refuses a path whose lease belongs to a known execution', async () => {
    const { svc, fs } = setup(stateWithTask([execution('viva')]));
    const wt = paths.worktree(REPO_ID, 'viva');
    fs.seed(`${wt}/arquivo.txt`, 'x');
    fs.seed(
      paths.lease(REPO_ID, 'viva'),
      JSON.stringify({ execId: 'viva', worktreePath: wt, createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    await expect(svc.cleanResidue(wt)).rejects.toMatchObject({ code: 'WORKTREE_IN_USE' });
    expect(await fs.exists(`${wt}/arquivo.txt`)).toBe(true);
  });

  it('removes a registered worktree, its directory and an orphan lease, then prunes', async () => {
    const { svc, fs, runner } = setup(stateWithTask());
    const wt = paths.worktree(REPO_ID, 'orfa');
    fs.seed(`${wt}/arquivo.txt`, 'x');
    fs.seed(
      paths.lease(REPO_ID, 'orfa'),
      JSON.stringify({ execId: 'sumida', worktreePath: wt, createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    await svc.cleanResidue(wt);
    expect(await fs.exists(wt)).toBe(false);
    expect(await fs.exists(paths.lease(REPO_ID, 'orfa'))).toBe(false);
    const gitArgs = runner.calls.map((c) => c.args.filter((a) => a !== '-c' && a !== 'core.quotepath=off'));
    expect(gitArgs.some((a) => a.join(' ') === `worktree remove --force -- ${wt}`)).toBe(true);
    expect(gitArgs.some((a) => a.join(' ') === 'worktree prune')).toBe(true);
    for (const c of runner.calls) expect(c.opts.cwd).toBe('/repos/app');
  });

  it('removes a loose directory with no lease', async () => {
    const { svc, fs } = setup(stateWithTask());
    const wt = paths.worktree(REPO_ID, 'solto');
    fs.seed(`${wt}/a/b.txt`, 'x');
    await svc.cleanResidue(wt);
    expect(await fs.exists(wt)).toBe(false);
  });
});
