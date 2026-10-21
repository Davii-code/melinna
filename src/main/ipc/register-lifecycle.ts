import type { ExecutionService } from '../../core/execution/execution-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseExecId, parseRelaunch, parseRemove } from './validate-lifecycle';

export interface LifecycleIpcDeps {
  executions: ExecutionService;
  model: WorkspaceModel;
  log: Logger;
}

/** Canais de parar, relançar e remover execuções. */
export function registerLifecycle(handle: Handle, deps: LifecycleIpcDeps): void {
  const { executions, model, log } = deps;
  const C = CHANNELS.executions;
  const exists = (id: string) => model.execution(id) !== undefined;
  handle(
    C.stop,
    handler(log, C.stop, parseExecId(exists), (id) => executions.stop(id)),
  );
  handle(
    C.relaunch,
    handler(log, C.relaunch, parseRelaunch(exists), (id, size) => executions.relaunch(id, size)),
  );
  handle(
    C.removalCheck,
    handler(log, C.removalCheck, parseExecId(exists), (id) => executions.removalCheck(id)),
  );
  handle(
    C.remove,
    handler(log, C.remove, parseRemove(exists), (id, opts) => executions.remove(id, opts)),
  );
}
