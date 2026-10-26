import type { ExecutionService } from '../../core/execution/execution-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseCancelSwitch, parseConfirmSwitch, parseRequestSwitch } from './validate-switch';

export interface SwitchIpcDeps {
  executions: ExecutionService;
  model: WorkspaceModel;
  log: Logger;
}

/** Canais de troca de modelo e de modo de permissão. */
export function registerSwitch(handle: Handle, deps: SwitchIpcDeps): void {
  const { executions, model, log } = deps;
  const C = CHANNELS.executions;
  const exists = (id: string) => model.execution(id) !== undefined;
  handle(
    C.requestSwitch,
    handler(log, C.requestSwitch, parseRequestSwitch(exists), (id, kind, value) =>
      executions.requestSwitch(id, kind, value),
    ),
  );
  handle(
    C.confirmSwitch,
    handler(log, C.confirmSwitch, parseConfirmSwitch(exists), (id, planId) =>
      executions.confirmSwitch(id, planId),
    ),
  );
  handle(
    C.cancelPendingSwitch,
    handler(log, C.cancelPendingSwitch, parseCancelSwitch(exists), (id) =>
      executions.cancelPendingSwitch(id),
    ),
  );
}
