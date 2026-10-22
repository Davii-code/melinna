import { describe, expect, it } from 'vitest';
import { isLiveStatus, modelLabel, permissionLabel, statusLabel } from '../../../src/renderer/labels';
import { agentDef, execution } from '../../support/renderer-fixtures';

describe('labels', () => {
  it('labels every status in pt-BR', () => {
    const cases: [Parameters<typeof execution>[1], string][] = [
      [{ status: 'preparing' }, 'preparando'],
      [{ status: 'starting' }, 'iniciando'],
      [{ status: 'running' }, 'rodando'],
      [{ status: 'idle' }, 'ocioso'],
      [{ status: 'exited', exitCode: 2 }, 'encerrado (código 2)'],
      [{ status: 'exited', exitCode: null, signal: 'SIGKILL' }, 'encerrado (sinal SIGKILL)'],
      [{ status: 'failed_to_start' }, 'falhou ao iniciar'],
      [{ status: 'lost' }, 'perdido'],
    ];
    for (const [over, label] of cases) expect(statusLabel(execution('x', over))).toBe(label);
  });

  it('tells live statuses apart', () => {
    expect(isLiveStatus('idle')).toBe(true);
    expect(isLiveStatus('preparing')).toBe(true);
    expect(isLiveStatus('exited')).toBe(false);
    expect(isLiveStatus('lost')).toBe(false);
  });

  it('uses the catalog labels for model and mode, falling back to the raw value', () => {
    const claude = agentDef('claude');
    expect(modelLabel(claude, 'sonnet')).toBe('Sonnet');
    expect(modelLabel(claude, 'gpt-x')).toBe('gpt-x');
    expect(modelLabel(claude, null)).toBeNull();
    expect(permissionLabel(claude, 'manual')).toBe('Perguntar');
    expect(permissionLabel(undefined, 'bypass')).toBe('bypass');
    expect(permissionLabel(claude, null)).toBeNull();
  });
});
