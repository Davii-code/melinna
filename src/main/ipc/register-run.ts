import type { Logger } from '../../core/ports/logger';
import type { RunService } from '../../core/run/run-service';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { noArgs } from './validate-common';
import { parseRemoveCommand, parseRerun, parseRunStart, parseSaveCommand } from './validate-run';

export interface RunIpcDeps {
  run: RunService;
  model: WorkspaceModel;
  log: Logger;
}

/** Canais das configurações de execução; parar usa `executions:stop`. O renderer só envia ids. */
export function registerRun(handle: Handle, deps: RunIpcDeps): void {
  const { run, model, log } = deps;
  const C = CHANNELS.run;
  const groupExists = (id: string) => model.group(id) !== undefined;
  const isCommandExecution = (id: string) => {
    const exec = model.execution(id);
    return exec === undefined ? undefined : exec.command !== undefined;
  };
  handle(
    C.list,
    handler(log, C.list, noArgs, () => run.list()),
  );
  handle(
    C.start,
    handler(log, C.start, parseRunStart(groupExists), (groupId, commandId, size, choice) =>
      run.start(groupId, commandId, size, choice),
    ),
  );
  handle(
    C.rerun,
    handler(log, C.rerun, parseRerun(isCommandExecution), (execId, size) => run.rerun(execId, size)),
  );
  handle(
    C.saveCommand,
    handler(log, C.saveCommand, parseSaveCommand(groupExists), (groupId, input) =>
      run.saveCommand(groupId, input),
    ),
  );
  handle(
    C.removeCommand,
    handler(log, C.removeCommand, parseRemoveCommand(groupExists), (groupId, commandId) =>
      run.removeCommand(groupId, commandId),
    ),
  );
}
