import { describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '../../../../src/core/automations/types';
import { MelinnaError } from '../../../../src/core/errors';
import { registerAutomations } from '../../../../src/main/ipc/register-automations';
import { handleRecorder } from '../../../support/fake-core';
import { MemoryLogger } from '../../../support/fakes/logger';

const AUTOMATION: Automation = {
  id: 'a1',
  name: 'Relatório',
  folder: '/repos/site',
  agentId: 'claude',
  prompt: 'Gere o relatório secreto.',
  schedule: { kind: 'interval', minutes: 30 },
  enabled: true,
  isolation: 'direct',
  createdAt: '2026-03-01T10:00:00.000Z',
  lastRun: null,
};
const RUN: AutomationRun = { at: '2026-03-01T10:30:00.000Z', status: 'launched', taskId: 't1' };

function setup() {
  const store = {
    list: vi.fn(() => [AUTOMATION]),
    isReadOnly: vi.fn(() => false),
    save: vi.fn(async (_input: unknown) => AUTOMATION),
    remove: vi.fn(async (_id: string) => undefined),
    setEnabled: vi.fn(async (_id: string, _enabled: boolean) => undefined),
  };
  const scheduler = {
    nextRunAt: vi.fn((_id: string) => '2026-03-01T10:30:00.000Z' as string | null),
    runNow: vi.fn(async (_id: string) => RUN),
  };
  const log = new MemoryLogger();
  const rec = handleRecorder();
  registerAutomations(rec.handle, { store, scheduler, log });
  return { store, scheduler, log, rec };
}

describe('automations IPC', () => {
  it('registers every automations channel', () => {
    expect(setup().rec.channels()).toEqual([
      'automations:list',
      'automations:remove',
      'automations:runNow',
      'automations:save',
      'automations:setEnabled',
    ]);
  });

  it('lists the automations with the next run and the read-only flag', async () => {
    const { rec } = setup();
    expect(await rec.call('automations:list')).toEqual({
      ok: true,
      value: { automations: [{ ...AUTOMATION, nextRunAt: '2026-03-01T10:30:00.000Z' }], readOnly: false },
    });
    expect((await rec.call('automations:list', 'extra')).error?.code).toBe('INPUT_INVALID');
  });

  it('hands the raw input to the store, which validates it', async () => {
    const { rec, store } = setup();
    const input = { name: 'x' };
    expect((await rec.call('automations:save', input)).ok).toBe(true);
    expect(store.save).toHaveBeenCalledWith(input);
    store.save.mockRejectedValueOnce(new MelinnaError('INPUT_INVALID', { userMessage: 'Agendamento inválido.' }));
    expect((await rec.call('automations:save', input)).error).toMatchObject({
      code: 'INPUT_INVALID',
      message: 'Agendamento inválido.',
    });
  });

  it('validates the id and the state of remove, setEnabled and runNow', async () => {
    const { rec, store, scheduler } = setup();
    expect((await rec.call('automations:remove', '../x')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('automations:setEnabled', 'a1', 'sim')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('automations:runNow', 42)).error?.code).toBe('INPUT_INVALID');
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.setEnabled).not.toHaveBeenCalled();
    expect(scheduler.runNow).not.toHaveBeenCalled();
  });

  it('removes, toggles and runs now', async () => {
    const { rec, store, scheduler } = setup();
    expect((await rec.call('automations:remove', 'a1')).ok).toBe(true);
    expect((await rec.call('automations:setEnabled', 'a1', false)).ok).toBe(true);
    expect(await rec.call('automations:runNow', 'a1')).toEqual({ ok: true, value: RUN });
    expect(store.remove).toHaveBeenCalledWith('a1');
    expect(store.setEnabled).toHaveBeenCalledWith('a1', false);
    expect(scheduler.runNow).toHaveBeenCalledWith('a1');
  });

  it('never logs the prompt', async () => {
    const { rec, log } = setup();
    await rec.call('automations:list');
    await rec.call('automations:save', { prompt: 'Gere o relatório secreto.' });
    expect(log.text()).not.toContain('secreto');
  });
});
