import type { Execution, ExecutionStatus } from '../shared/ipc-contract';

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
