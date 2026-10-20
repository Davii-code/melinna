import { MelinnaError } from '../errors';
import type { ExecutionStatus } from '../persistence/state-schema';

export type ExecutionEvent =
  'prepared' | 'spawned' | 'output' | 'quiet' | 'exit' | 'fail' | 'lost' | 'relaunch' | 'remove';

const LIVE: ReadonlySet<ExecutionStatus> = new Set(['preparing', 'starting', 'running', 'idle']);
const ENDED: ReadonlySet<ExecutionStatus> = new Set(['exited', 'failed_to_start', 'lost']);

export function isLive(status: ExecutionStatus): boolean {
  return LIVE.has(status);
}

export function isEnded(status: ExecutionStatus): boolean {
  return ENDED.has(status);
}

const TRANSITIONS: Record<ExecutionEvent, Partial<Record<ExecutionStatus, ExecutionStatus>>> = {
  prepared: { preparing: 'starting' },
  spawned: { starting: 'running' },
  output: { idle: 'running', running: 'running' },
  quiet: { running: 'idle', idle: 'idle' },
  exit: { starting: 'exited', running: 'exited', idle: 'exited' },
  fail: { preparing: 'failed_to_start', starting: 'failed_to_start' },
  lost: { starting: 'lost', running: 'lost', idle: 'lost' },
  relaunch: { exited: 'starting', failed_to_start: 'starting', lost: 'starting' },
  remove: { exited: 'exited', failed_to_start: 'failed_to_start', lost: 'lost' },
};

/** Aplica um evento à máquina de estados; transições fora do grafo lançam MelinnaError. */
export function transition(status: ExecutionStatus, event: ExecutionEvent): ExecutionStatus {
  const next = TRANSITIONS[event][status];
  if (next !== undefined) return next;
  throw new MelinnaError(isLive(status) ? 'EXECUTION_RUNNING' : 'EXECUTION_NOT_RUNNING', {
    details: { status, event },
  });
}

export function canTransition(status: ExecutionStatus, event: ExecutionEvent): boolean {
  return TRANSITIONS[event][status] !== undefined;
}
