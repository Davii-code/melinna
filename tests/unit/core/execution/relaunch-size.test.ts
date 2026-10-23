import { describe, expect, it } from 'vitest';
import { createFakeCore } from '../../../support/fake-core';

async function launchedAndStopped() {
  const core = createFakeCore();
  const g = await core.workspace.createGroup('G');
  const task = await core.workspace.createTask({ groupId: g.id, repoPath: '/repo', baseRef: 'main', prompt: '' });
  const [r] = await core.executions.launch(task.id, [{ agentId: 'fake' }], { cols: 100, rows: 30 });
  if (!r?.ok) throw new Error('lançamento falhou');
  await core.executions.stop(r.execId);
  return { core, execId: r.execId };
}

describe('ExecutionService.relaunch — tamanho do terminal', () => {
  it('relaunches with the size the panel reported, not the default the page sent', async () => {
    const { core, execId } = await launchedAndStopped();
    core.executions.resize(execId, { cols: 160, rows: 42 });
    await core.executions.relaunch(execId, { cols: 100, rows: 30 });
    expect(core.host.spawns.at(-1)).toMatchObject({ cols: 160, rows: 42 });
  });

  it('remembers the panel size reported while the execution was running', async () => {
    const core = createFakeCore();
    const g = await core.workspace.createGroup('G');
    const task = await core.workspace.createTask({ groupId: g.id, repoPath: '/repo', baseRef: 'main', prompt: '' });
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake' }], { cols: 100, rows: 30 });
    const execId = r?.execId ?? '';
    core.executions.resize(execId, { cols: 140, rows: 35 });
    await core.executions.stop(execId);
    await core.executions.relaunch(execId, { cols: 100, rows: 30 });
    expect(core.host.spawns.at(-1)).toMatchObject({ cols: 140, rows: 35 });
  });

  it('uses the size it was given when the panel never reported one', async () => {
    const { core, execId } = await launchedAndStopped();
    await core.executions.relaunch(execId, { cols: 90, rows: 25 });
    expect(core.host.spawns.at(-1)).toMatchObject({ cols: 90, rows: 25 });
  });

  it('keeps the clamping of absurd sizes', async () => {
    const { core, execId } = await launchedAndStopped();
    core.executions.resize(execId, { cols: 5000, rows: 2 });
    await core.executions.relaunch(execId, { cols: 100, rows: 30 });
    expect(core.host.spawns.at(-1)).toMatchObject({ cols: 1000, rows: 5 });
  });
});
