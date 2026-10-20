import type { HostProcessInfo } from '../contracts/host-protocol';
import type { HostClient } from '../ports/host-client';
import type { ExecutionContext } from './context';

const LOST_MESSAGE = 'O processo não está mais vivo (o hospedeiro de terminais foi encerrado).';

/**
 * Na abertura do app: vivas no hospedeiro continuam `running`; com término registrado viram `exited`;
 * ausentes viram `lost`. Preparos interrompidos viram `failed_to_start`.
 */
export async function reconcileWithHost(ctx: ExecutionContext, host: HostClient | null): Promise<void> {
  const processes: HostProcessInfo[] = host ? await host.list().catch(() => []) : [];
  const byId = new Map(processes.map((p) => [p.execId, p]));
  for (const exec of ctx.model.raw.executions) {
    if (exec.status === 'preparing') {
      ctx.update(exec.id, {
        status: 'failed_to_start',
        failure: { code: 'INTERNAL', message: 'O preparo foi interrompido quando o app fechou.' },
      });
      continue;
    }
    if (exec.status !== 'starting' && exec.status !== 'running' && exec.status !== 'idle') continue;
    const proc = byId.get(exec.id);
    if (proc?.alive) {
      ctx.update(exec.id, { status: 'running', pid: proc.pid });
      ctx.busy.activity(exec.id);
    } else if (proc && proc.endedAt) {
      ctx.update(exec.id, {
        status: 'exited',
        exitCode: proc.exitCode,
        signal: proc.signal,
        endedAt: proc.endedAt,
        pid: null,
      });
    } else {
      ctx.update(exec.id, {
        status: 'lost',
        pid: null,
        failure: { code: 'HOST_UNAVAILABLE', message: LOST_MESSAGE },
      });
    }
  }
}

/** Queda do hospedeiro: execuções vivas viram `lost`; o próximo lançamento inicia um hospedeiro novo. */
export function markLiveAsLost(ctx: ExecutionContext): void {
  for (const exec of ctx.model.raw.executions) {
    if (exec.status === 'starting' || exec.status === 'running' || exec.status === 'idle') {
      ctx.busy.ended(exec.id);
      ctx.update(exec.id, {
        status: 'lost',
        pid: null,
        failure: { code: 'HOST_UNAVAILABLE', message: LOST_MESSAGE },
      });
    }
  }
}
