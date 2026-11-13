import { describe, expect, it, vi } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { BACKGROUND_TERM_SIZE, SessionLauncher } from '../../../../src/core/workspace/session-launcher';
import { createFakeCore } from '../../../support/fake-core';

function setup() {
  const core = createFakeCore();
  const launcher = new SessionLauncher({ workspace: core.workspace, executions: core.executions });
  return { core, launcher };
}

const INPUT = { folder: '/repo', agentId: 'fake', prompt: 'Faça X', isolation: 'direct' as const };

describe('SessionLauncher', () => {
  it('opens the folder as a workspace, creates the task and launches the agent in it', async () => {
    const { core, launcher } = setup();
    const session = await launcher.launch({ ...INPUT, title: 'Relatório' });
    const snap = core.workspace.snapshot();
    expect(snap.tasks).toHaveLength(1);
    expect(snap.tasks[0]).toMatchObject({ id: session.taskId, title: 'Relatório', isolation: 'direct' });
    expect(snap.executions[0]).toMatchObject({ id: session.execId, agentId: 'fake', worktreePath: '/repo' });
    expect(core.host.spawns[0]).toMatchObject({ cwd: '/repo', ...BACKGROUND_TERM_SIZE });
    expect(core.host.spawns[0]?.args.at(-1)).toBe('Faça X');
  });

  it('reuses the workspace of the folder on the next launch', async () => {
    const { core, launcher } = setup();
    await launcher.launch(INPUT);
    await launcher.launch(INPUT);
    const snap = core.workspace.snapshot();
    expect(snap.groups).toHaveLength(1);
    expect(snap.tasks).toHaveLength(2);
  });

  it('isolates the session in a worktree when asked', async () => {
    const { core, launcher } = setup();
    const session = await launcher.launch({ ...INPUT, isolation: 'worktree' });
    const exec = core.workspace.snapshot().executions.find((e) => e.id === session.execId);
    expect(exec?.worktreePath).not.toBe('/repo');
    expect(exec?.branch).not.toBe('');
  });

  it('passes on the model and the permission mode', async () => {
    const { core, launcher } = setup();
    await launcher.launch({ ...INPUT, model: 'esperto' });
    expect(core.host.spawns[0]?.args).toEqual(['--model', 'esperto', 'Faça X']);
  });

  it('fails with the reason when the agent cannot be launched', async () => {
    const { launcher } = setup();
    const err = (await launcher
      .launch({ ...INPUT, agentId: 'nao-existe' })
      .catch((e: unknown) => e)) as MelinnaError;
    expect(err.code).toBe('AGENT_NOT_FOUND');
    expect(err.details).toMatchObject({ taskId: expect.any(String) });
  });

  it('fails before creating a task when the folder does not exist', async () => {
    const { core, launcher } = setup();
    const err = (await launcher
      .launch({ ...INPUT, folder: '/nao/existe' })
      .catch((e: unknown) => e)) as MelinnaError;
    expect(err.code).toBe('INPUT_INVALID');
    expect(core.workspace.snapshot().tasks).toEqual([]);
  });
});

it('refuses a full app before persisting a task', async () => {
  const { core, launcher } = setup();
  vi.spyOn(core.executions, 'liveCount').mockReturnValue(12);
  await expect(launcher.launch(INPUT)).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  expect(core.workspace.snapshot().tasks).toEqual([]);
});

it('removes the empty task if another launch takes the last slot during preparation', async () => {
  const { core, launcher } = setup();
  vi.spyOn(core.executions, 'launch').mockRejectedValueOnce(new MelinnaError('LIMIT_REACHED'));
  await expect(launcher.launch(INPUT)).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
  expect(core.workspace.snapshot().tasks).toEqual([]);
});
