import type { SwitchKind, SwitchPlan } from '../api-types';
import { resolveModel, resolvePermission } from '../catalog/launch-plan';
import type { AgentDefinition, SwitchStrategy } from '../catalog/schema';
import { MelinnaError } from '../errors';
import type { Execution } from '../persistence/state-schema';

export interface SwitchRequest {
  kind: SwitchKind;
  value: string;
}

/** Estratégia de troca declarada no catálogo para o tipo pedido; ausente = agente sem esse seletor. */
export function strategyOf(def: AgentDefinition, kind: SwitchKind): SwitchStrategy | null {
  if (kind === 'model') return def.model?.switch ?? null;
  return def.permission?.switch ?? null;
}

/**
 * Decide como aplicar uma troca de modelo ou de modo numa execução viva, conforme o catálogo:
 * comando no PTY (espera ficar ocioso se ocupado), relançamento com retomada ou relançamento sem contexto.
 * Valida o valor contra o catálogo; não muda nada.
 */
export function planSwitch(
  def: AgentDefinition,
  exec: Pick<Execution, 'status' | 'model' | 'permissionMode'>,
  req: SwitchRequest,
  busy: boolean,
  planId: string,
): SwitchPlan {
  const strategy = strategyOf(def, req.kind);
  if (def.kind === 'shell' || !strategy) {
    throw new MelinnaError('SWITCH_UNSUPPORTED', {
      userMessage: `Este agente não tem ${req.kind === 'model' ? 'seletor de modelo' : 'modos de permissão'}.`,
    });
  }
  if (exec.status !== 'running' && exec.status !== 'idle') {
    throw new MelinnaError('EXECUTION_NOT_RUNNING', {
      userMessage: 'A troca só é possível com a execução rodando.',
    });
  }
  const current = req.kind === 'model' ? exec.model : exec.permissionMode;
  const value = req.kind === 'model' ? resolveModel(def, req.value) : resolvePermission(def, req.value);
  if (value === current) {
    throw new MelinnaError('INPUT_INVALID', { userMessage: 'Esse valor já está em uso nesta execução.' });
  }
  const dangerous =
    req.kind === 'permission' && Boolean(def.permission?.options.find((o) => o.id === value)?.dangerous);
  switch (strategy.strategy) {
    case 'pty-command':
      return { planId, kind: 'pty-command', waitsForIdle: busy, dangerous };
    case 'restart-resume':
      return { planId, kind: 'restart-resume', interruptsResponse: busy, dangerous };
    case 'unsupported':
      return { planId, kind: 'restart-fresh', losesConversation: true, interruptsResponse: busy, dangerous };
  }
}
