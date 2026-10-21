import { describe, expect, it } from 'vitest';
import { registerSwitch } from '../../../../src/main/ipc/register-switch';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

async function setup(agentId = 'fake') {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerSwitch(rec.handle, { executions: core.executions, model: core.model, log: core.log });
  const g = await core.workspace.createGroup('G');
  const task = await core.workspace.createTask({ groupId: g.id, repoPath: '/repo', baseRef: 'main', prompt: 'X' });
  const [r] = await core.executions.launch(task.id, [{ agentId }], { cols: 80, rows: 24 });
  if (!r?.ok) throw new Error('lançamento falhou');
  core.clock.advance(2000);
  return { core, rec, execId: r.execId };
}

describe('switch IPC', () => {
  it('registers the switch channels', async () => {
    expect((await setup()).rec.channels()).toEqual([
      'executions:cancelPendingSwitch',
      'executions:confirmSwitch',
      'executions:requestSwitch',
    ]);
  });

  it('plans and confirms a model switch by command', async () => {
    const { rec, core, execId } = await setup();
    const plan = await rec.call('executions:requestSwitch', execId, 'model', 'esperto');
    expect(plan).toMatchObject({ ok: true, value: { kind: 'pty-command', waitsForIdle: false } });
    const planId = (plan.value as { planId: string }).planId;
    expect(await rec.call('executions:confirmSwitch', execId, planId)).toEqual({ ok: true, value: undefined });
    expect(core.host.writes.at(-1)).toEqual({ execId, data: '/model esperto\r' });
    expect(core.model.execution(execId)?.model).toBe('esperto');
  });

  it('cancels a pending switch', async () => {
    const { rec, core, execId } = await setup();
    core.host.output(execId, 'trabalhando');
    const plan = await rec.call('executions:requestSwitch', execId, 'permission', 'livre');
    expect(plan.value).toMatchObject({ kind: 'pty-command', waitsForIdle: true, dangerous: true });
    await rec.call('executions:confirmSwitch', execId, (plan.value as { planId: string }).planId);
    expect(core.model.execution(execId)?.pendingSwitch).toEqual({ kind: 'permission', value: 'livre' });
    expect(await rec.call('executions:cancelPendingSwitch', execId)).toEqual({ ok: true, value: undefined });
    expect(core.model.execution(execId)?.pendingSwitch).toBeNull();
    core.clock.advance(3000);
    expect(core.host.writes.some((w) => w.data.includes('/permission'))).toBe(false);
  });

  it('maps catalog errors and validates the payload', async () => {
    const { rec, execId } = await setup();
    const code = async (...args: unknown[]) => (await rec.call('executions:requestSwitch', ...args)).error?.code;
    expect(await code(execId, 'model', 'nome inválido!')).toBe('INPUT_INVALID');
    expect(await code(execId, 'cor', 'azul')).toBe('INPUT_INVALID');
    expect(await code(execId, 'model', '')).toBe('INPUT_INVALID');
    expect(await code(execId, 'model', 'x'.repeat(101))).toBe('INPUT_INVALID');
    expect(await code('nao-existe', 'model', 'esperto')).toBe('INPUT_INVALID');
    expect((await rec.call('executions:confirmSwitch', execId, 'plano-velho')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('executions:confirmSwitch', execId)).error?.code).toBe('INPUT_INVALID');
  });

  it('refuses switching a shell', async () => {
    const { rec, execId } = await setup('bash');
    expect((await rec.call('executions:requestSwitch', execId, 'model', 'x')).error?.code).toBe('SWITCH_UNSUPPORTED');
  });
});
