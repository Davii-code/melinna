import { describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../../../../src/core/catalog/schema';
import { planSwitch } from '../../../../src/core/execution/switch-planner';
import { FAKE_AGENTS } from '../../../support/fake-core';

const def = (id: keyof typeof FAKE_AGENTS) => FAKE_AGENTS[id] as unknown as AgentDefinition;
const running = { status: 'running' as const, model: 'rapido', permissionMode: 'perguntar' };

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('planSwitch', () => {
  it('pty-command waits for idle only when busy', () => {
    expect(planSwitch(def('fake'), running, { kind: 'model', value: 'esperto' }, false, 'p1')).toEqual({
      planId: 'p1',
      kind: 'pty-command',
      waitsForIdle: false,
      dangerous: false,
    });
    expect(planSwitch(def('fake'), running, { kind: 'model', value: 'esperto' }, true, 'p2')).toMatchObject({
      kind: 'pty-command',
      waitsForIdle: true,
    });
  });

  it('restart-resume interrupts the response when busy', () => {
    expect(planSwitch(def('fake-resume'), running, { kind: 'model', value: 'esperto' }, true, 'p')).toEqual({
      planId: 'p',
      kind: 'restart-resume',
      interruptsResponse: true,
      dangerous: false,
    });
    expect(
      planSwitch(def('fake-resume'), running, { kind: 'permission', value: 'livre' }, false, 'p'),
    ).toMatchObject({ kind: 'restart-resume', interruptsResponse: false, dangerous: true });
  });

  it('unsupported relaunches losing the conversation', () => {
    expect(planSwitch(def('fake-nosw'), running, { kind: 'model', value: 'esperto' }, false, 'p')).toEqual({
      planId: 'p',
      kind: 'restart-fresh',
      losesConversation: true,
      interruptsResponse: false,
      dangerous: false,
    });
  });

  it('marks dangerous permission modes for confirmation', () => {
    expect(planSwitch(def('fake'), running, { kind: 'permission', value: 'livre' }, false, 'p').dangerous).toBe(true);
    expect(planSwitch(def('fake'), { ...running, permissionMode: 'livre' }, { kind: 'permission', value: 'perguntar' }, false, 'p').dangerous).toBe(false);
  });

  it('validates the value against the catalog', () => {
    expect(code(() => planSwitch(def('fake-resume'), running, { kind: 'model', value: 'outro' }, false, 'p'))).toBe(
      'INPUT_INVALID',
    );
    expect(code(() => planSwitch(def('fake'), running, { kind: 'model', value: 'nome inválido!' }, false, 'p'))).toBe(
      'INPUT_INVALID',
    );
    expect(code(() => planSwitch(def('fake'), running, { kind: 'permission', value: 'nao' }, false, 'p'))).toBe(
      'INPUT_INVALID',
    );
    expect(code(() => planSwitch(def('fake'), running, { kind: 'model', value: 'rapido' }, false, 'p'))).toBe(
      'INPUT_INVALID',
    );
    expect(planSwitch(def('fake'), running, { kind: 'model', value: 'custom-1.0' }, false, 'p').kind).toBe(
      'pty-command',
    );
  });

  it('refuses shells and executions that are not running', () => {
    expect(code(() => planSwitch(def('bash'), { status: 'running', model: null, permissionMode: null }, { kind: 'model', value: 'x' }, false, 'p'))).toBe(
      'SWITCH_UNSUPPORTED',
    );
    for (const status of ['exited', 'lost', 'failed_to_start', 'preparing', 'starting'] as const) {
      expect(code(() => planSwitch(def('fake'), { ...running, status }, { kind: 'model', value: 'esperto' }, false, 'p'))).toBe(
        'EXECUTION_NOT_RUNNING',
      );
    }
    expect(planSwitch(def('fake'), { ...running, status: 'idle' }, { kind: 'model', value: 'esperto' }, false, 'p').kind).toBe(
      'pty-command',
    );
  });
});
