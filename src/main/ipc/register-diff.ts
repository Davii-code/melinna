import type { ExecutionService } from '../../core/execution/execution-service';
import type { DiffService } from '../../core/git/diff';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseDiffExecId } from './validate-diff';

export interface DiffIpcDeps {
  diff: DiffService;
  executions: ExecutionService;
  model: WorkspaceModel;
  log: Logger;
}

/** Canais de diff e de divergência da base. */
export function registerDiff(handle: Handle, deps: DiffIpcDeps): void {
  const { diff, executions, model, log } = deps;
  const C = CHANNELS.executions;
  const parse = parseDiffExecId((id) => model.execution(id) !== undefined);
  handle(
    C.diff,
    handler(log, C.diff, parse, (id) => diff.diff(id)),
  );
  handle(
    C.divergence,
    handler(log, C.divergence, parse, (id) => executions.divergence(id)),
  );
}
