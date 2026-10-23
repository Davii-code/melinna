import { describe, expect, it } from 'vitest';
import { createFakeCore } from '../../../support/fake-core';

const SIZE = { cols: 100, rows: 30 };

async function launched() {
  const core = createFakeCore();
  const g = await core.workspace.createGroup('G');
  const task = await core.workspace.createTask({
    groupId: g.id,
    repoPath: '/repo',
    baseRef: 'main',
    prompt: '',
    isolation: 'direct',
  });
  const [r] = await core.executions.launch(task.id, [{ agentId: 'fake' }], SIZE);
  if (!r?.ok) throw new Error('lançamento falhou');
  // O lançamento conta como atividade: espera o silêncio, e a execução fica ociosa antes de cada teste.
  core.clock.advance(10 ** 12);
  expect(core.model.execution(r.execId)?.status).toBe('idle');
  return { core, execId: r.execId, taskId: task.id };
}

/** Deixa passar o silêncio que faz a execução voltar a ficar ociosa. */
const quiet = (core: Awaited<ReturnType<typeof launched>>['core']) => core.clock.advance(10 ** 12);

describe('ExecutionService.onBusy / onIdle', () => {
  it('announces busy on output and idle after the quiet period, with the status already updated', async () => {
    const { core, execId } = await launched();
    const seen: string[] = [];
    core.executions.onBusy((id) => seen.push(`busy:${id}:${core.model.execution(id)?.status}`));
    core.executions.onIdle((id) => seen.push(`idle:${id}:${core.model.execution(id)?.status}`));
    core.host.output(execId, 'olá');
    quiet(core);
    expect(seen).toEqual([`busy:${execId}:running`, `idle:${execId}:idle`]);
  });

  it('announces each busy → idle cycle', async () => {
    const { core, execId } = await launched();
    let idle = 0;
    core.executions.onIdle(() => idle++);
    for (let i = 0; i < 3; i++) {
      core.host.output(execId, 'x');
      quiet(core);
    }
    expect(idle).toBe(3);
  });

  it('stops announcing after unsubscribe', async () => {
    const { core, execId } = await launched();
    let calls = 0;
    const off = core.executions.onIdle(() => calls++);
    off();
    core.host.output(execId, 'x');
    quiet(core);
    expect(calls).toBe(0);
  });
});

describe('ExecutionService.onEnded', () => {
  it('announces a process that exited, after the status changed', async () => {
    const { core, execId } = await launched();
    const seen: string[] = [];
    core.executions.onEnded((id, reason) => seen.push(`${id}:${reason}:${core.model.execution(id)?.status}`));
    core.host.exit(execId, 0);
    expect(seen).toEqual([`${execId}:ended:exited`]);
  });

  it('announces executions lost when the host goes away', async () => {
    const { core, execId } = await launched();
    const seen: string[] = [];
    core.executions.onEnded((id, reason) => seen.push(`${id}:${reason}`));
    core.host.disconnect();
    expect(seen).toEqual([`${execId}:ended`]);
    expect(core.model.execution(execId)?.status).toBe('lost');
  });

  it('announces the removal of an execution', async () => {
    const { core, execId } = await launched();
    core.host.exit(execId, 0);
    const seen: string[] = [];
    core.executions.onEnded((id, reason) => seen.push(`${id}:${reason}`));
    await core.executions.remove(execId, { deleteBranch: false, force: true });
    expect(seen).toEqual([`${execId}:removed`]);
  });

  it('announces the removal of every execution of a removed session', async () => {
    const { core, execId, taskId } = await launched();
    core.host.exit(execId, 0);
    const seen: string[] = [];
    core.executions.onEnded((id, reason) => seen.push(`${id}:${reason}`));
    await core.executions.removeTask(taskId);
    expect(seen).toEqual([`${execId}:removed`]);
  });

  it('does not announce again for an execution that was already over', async () => {
    const { core, execId } = await launched();
    core.host.exit(execId, 0);
    const seen: string[] = [];
    core.executions.onEnded((id) => seen.push(id));
    core.host.disconnect();
    expect(seen).toEqual([]);
  });
});
