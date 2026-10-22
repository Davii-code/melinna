import type { AgentDefinition, Execution, ExecutionStatus } from '../shared/ipc-contract';

const STATUS: Record<ExecutionStatus, string> = {
  preparing: 'preparando',
  starting: 'iniciando',
  running: 'rodando',
  idle: 'ocioso',
  exited: 'encerrado',
  failed_to_start: 'falhou ao iniciar',
  lost: 'perdido',
};

export function statusLabel(e: Pick<Execution, 'status' | 'exitCode' | 'signal'>): string {
  if (e.status === 'exited')
    return e.signal ? `encerrado (sinal ${e.signal})` : `encerrado (código ${e.exitCode ?? '?'})`;
  return STATUS[e.status];
}

export function isLiveStatus(s: ExecutionStatus): boolean {
  return s === 'preparing' || s === 'starting' || s === 'running' || s === 'idle';
}

export function permissionLabel(agent: AgentDefinition | undefined, mode: string | null): string | null {
  if (!mode) return null;
  return agent?.permission?.options.find((o) => o.id === mode)?.label ?? mode;
}

export function modelLabel(agent: AgentDefinition | undefined, model: string | null): string | null {
  if (!model) return null;
  return agent?.model?.options.find((o) => o.id === model)?.label ?? model;
}
