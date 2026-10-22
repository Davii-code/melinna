import { describe, expect, it } from 'vitest';
import { registerTasks } from '../../../../src/main/ipc/register-tasks';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

async function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerTasks(rec.handle, { workspace: core.workspace, executions: core.executions, log: core.log });
  const g = await core.workspace.createGroup('G');
  const input = {
    groupId: g.id,
    repoPath: '/repo',
    baseRef: 'main',
    prompt: 'Faça X',
    picks: [{ agentId: 'fake' }],
    size: { cols: 80, rows: 24 },
  };
  return { core, rec, input };
}

describe('tasks IPC', () => {
  it('creates the task and launches one execution per pick', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', {
      ...input,
      picks: [{ agentId: 'fake' }, { agentId: 'fake', model: 'esperto' }],
    });
    expect(r.ok).toBe(true);
    const value = r.value as { taskId: string; results: { ok: boolean }[] };
    expect(value.results.map((x) => x.ok)).toEqual([true, true]);
    expect(core.host.spawns).toHaveLength(2);
    expect(core.host.spawns[1]?.args).toEqual(['--model', 'esperto', 'Faça X']);
  });

  it('accepts an empty prompt and launches without it', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', { ...input, prompt: '' });
    expect(r.ok).toBe(true);
    expect(core.host.spawns[0]?.args).toEqual(['--model', 'rapido']);
  });

  it('validates the payload', async () => {
    const { rec, input } = await setup();
    const bad = async (v: unknown) => (await rec.call('tasks:createAndLaunch', v)).error?.code;
    expect(await bad(null)).toBe('INPUT_INVALID');
    expect(await bad({ ...input, picks: [] })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, picks: [{ agentId: 'Mau' }] })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, groupId: 'nao-existe' })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, prompt: 'x'.repeat(100_001) })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, size: { cols: 5, rows: 5 } })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, picks: Array.from({ length: 13 }, () => ({ agentId: 'fake' })) })).toBe(
      'LIMIT_REACHED',
    );
    expect(await bad({ ...input, repoPath: '/nao/existe' })).toBe('INPUT_INVALID');
  });

  it('runs the execution directly in the chosen folder, without a worktree or branch', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', input);
    expect(r.ok).toBe(true);
    const task = core.workspace.snapshot().tasks[0];
    expect(task).toMatchObject({ repoPath: '/repo', isolation: 'direct', baseCommit: '' });
    const exec = core.workspace.snapshot().executions[0];
    expect(exec).toMatchObject({ worktreePath: '/repo', branch: '' });
    expect(core.host.spawns[0]?.cwd).toBe('/repo');
    expect(core.runner.calls.some((c) => c.args.includes('worktree') && c.args.includes('add'))).toBe(false);
  });

  it('removes a stopped session without touching its folder', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', input);
    const { taskId, results } = r.value as { taskId: string; results: { execId: string }[] };
    expect(await rec.call('tasks:remove', taskId)).toMatchObject({
      ok: false,
      error: { code: 'EXECUTION_RUNNING' },
    });
    await core.executions.stop(results[0]?.execId ?? '');
    expect(await rec.call('tasks:remove', taskId)).toEqual({ ok: true, value: undefined });
    expect(core.workspace.snapshot().tasks).toHaveLength(0);
    expect(core.workspace.snapshot().executions).toHaveLength(0);
    expect(await core.fs.exists('/repo/README.md')).toBe(true);
  });

  it('removes a workspace with its stopped sessions and validates ids', async () => {
    const { rec, core, input } = await setup();
    const ws = await core.workspace.openWorkspace('/repo');
    await rec.call('tasks:createAndLaunch', { ...input, groupId: ws.id });
    const execId = core.workspace.snapshot().executions[0]?.id ?? '';
    await core.executions.stop(execId);
    expect(await rec.call('tasks:removeWorkspace', ws.id)).toEqual({ ok: true, value: undefined });
    expect(core.workspace.snapshot().groups.some((g) => g.id === ws.id)).toBe(false);
    expect(core.workspace.snapshot().tasks).toHaveLength(0);
    expect(await core.fs.exists('/repo/README.md')).toBe(true);
    expect((await rec.call('tasks:remove', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('tasks:removeWorkspace', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
  });

  it('adds one more terminal to a session, in the same folder and without the session prompt', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', input);
    const { taskId } = r.value as { taskId: string };
    const added = await rec.call(
      'tasks:addExecution',
      taskId,
      { agentId: 'fake', model: 'esperto' },
      input.size,
    );
    expect(added.ok).toBe(true);
    expect((added.value as { ok: boolean }[]).map((x) => x.ok)).toEqual([true]);
    const execs = core.workspace.snapshot().executions.filter((e) => e.taskId === taskId);
    expect(execs).toHaveLength(2);
    expect(execs[1]).toMatchObject({ worktreePath: '/repo', bandIndex: 1 });
    expect(core.host.spawns[1]?.args).toEqual(['--model', 'esperto']);
    expect(core.host.spawns[1]?.cwd).toBe('/repo');
  });

  it('validates addExecution', async () => {
    const { rec, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', input);
    const { taskId } = r.value as { taskId: string };
    const bad = async (...args: unknown[]) => (await rec.call('tasks:addExecution', ...args)).error?.code;
    expect(await bad('nao-existe', { agentId: 'fake' }, input.size)).toBe('INPUT_INVALID');
    expect(await bad(taskId, { agentId: 'Mau' }, input.size)).toBe('INPUT_INVALID');
    expect(await bad(taskId, { agentId: 'fake' }, { cols: 1, rows: 1 })).toBe('INPUT_INVALID');
  });
});
