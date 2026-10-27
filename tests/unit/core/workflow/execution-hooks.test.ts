import { describe, expect, it, vi } from 'vitest';
import { createFakeCore } from '../../../support/fake-core';
import { emptyState, type Task } from '../../../../src/core/persistence/state-schema';
import { RunService } from '../../../../src/core/run/run-service';
import { fakePlatform } from '../../../support/fakes/platform';
import { execution } from '../../../support/renderer-fixtures';
const SIZE = { cols: 100, rows: 30 };
describe('agent checkpoint integration', () => {
  it('runs file preparation and checkpoint before spawning and sends the reviewed briefing', async () => {
    const core = createFakeCore();
    const group = await core.workspace.createGroup('G');
    const task = await core.workspace.createTask({
      groupId: group.id,
      repoPath: '/repo',
      baseRef: 'main',
      prompt: 'old goal',
      isolation: 'direct',
    });
    const order: string[] = [];
    core.executions.context().beforeAgentStart = async () => {
      order.push('checkpoint');
      expect(core.host.spawns).toHaveLength(0);
    };
    const results = await core.executions.launch(task.id, [{ agentId: 'fake' }], SIZE, {
      prompt: 'reviewed handoff',
      prepareFiles: async () => {
        order.push('files');
      },
    });
    expect(results[0]?.ok).toBe(true);
    expect(order).toEqual(['files', 'checkpoint']);
    expect(core.host.spawns[0]?.args).toContain('reviewed handoff');
    expect(task.prompt).toBe('old goal');
  });
  it('never spawns the agent when the requested checkpoint fails', async () => {
    const core = createFakeCore();
    const group = await core.workspace.createGroup('G');
    const task = await core.workspace.createTask({
      groupId: group.id,
      repoPath: '/repo',
      baseRef: 'main',
      prompt: '',
      isolation: 'direct',
    });
    core.executions.context().beforeAgentStart = vi.fn(async () => {
      throw new Error('snapshot failed');
    });
    const results = await core.executions.launch(task.id, [{ agentId: 'fake' }], SIZE);
    expect(results[0]?.ok).toBe(false);
    expect(core.host.spawns).toHaveLength(0);
    expect(core.model.raw.executions[0]?.status).toBe('failed_to_start');
  });
});
function verificationRig(beforeLaunch = false) {
  const state = emptyState();
  state.groups.push({
    id: 'g1',
    name: 'Repo',
    order: 0,
    folders: [{ id: 'folder', path: '/repo' }],
    primaryFolderId: 'folder',
    repoPath: '/repo',
  });
  const task: Task = {
    id: 't1',
    groupId: 'g1',
    title: 'Worktree task',
    prompt: '',
    repoPath: '/repo',
    repoId: 'r1',
    baseRef: 'main',
    baseCommit: 'b'.repeat(40),
    slug: 'task',
    createdAt: new Date().toISOString(),
  };
  state.tasks.push(task);
  state.executions.push(
    execution('agent', { taskId: 't1', worktreePath: '/isolated/agent', status: 'exited' }),
  );
  const core = createFakeCore(state);
  core.fs.seed('/bin/node', 'binary');
  core.fs.seed('/isolated/agent/code.js', 'test');
  const common = {
    tool: 'program' as const,
    folder: '/repo',
    script: null,
    program: '/bin/node',
    args: ['--check', 'code.js'],
    runtimeOptions: '',
    env: [],
    allowParallel: false,
    folderGroup: null,
    order: 0,
  };
  const group = core.model.group('g1');
  if (!group) throw new Error('group');
  group.runConfigs = [
    ...(beforeLaunch ? [{ ...common, id: 'prepare', name: 'Prepare', beforeLaunch: null }] : []),
    { ...common, id: 'check', name: 'Check', beforeLaunch: beforeLaunch ? 'prepare' : null },
  ];
  return {
    core,
    run: new RunService({ executions: core.executions, platform: fakePlatform('linux', '/bin') }),
  };
}
describe('saved verification configurations in the actual checkout', () => {
  it('runs in the selected worktree and gives command records direct ownership', async () => {
    const { core, run } = verificationRig();
    const result = await run.startVerification('agent', 'check', SIZE, 'verification');
    if ('needsConfirm' in result) throw new Error('confirmation');
    expect(core.host.spawns[0]?.cwd).toBe('/isolated/agent');
    expect(core.model.task(result.taskId)?.isolation).toBe('direct');
    expect(core.model.execution(result.execId)?.command?.commandId).toContain('workflow-verify-');
  });
  it('cancels a before-launch chain without ever starting the main command', async () => {
    const { core, run } = verificationRig(true);
    const started = run.startVerification('agent', 'check', SIZE, 'verification');
    const outcome = started.catch((error) => error);
    await vi.waitFor(() => expect(core.host.spawns).toHaveLength(1));
    await run.cancelVerification('verification');
    expect(await outcome).toMatchObject({ code: 'RUN_BEFORE_LAUNCH_FAILED' });
    expect(core.host.spawns).toHaveLength(1);
  });
});
