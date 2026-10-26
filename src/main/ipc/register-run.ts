import type { Logger } from '../../core/ports/logger';
import type { RunService } from '../../core/run/run-service';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { noArgs } from './validate-common';
import { parseRemoveConfig, parseReorder, parseRerun, parseRunStart, parseSaveConfig } from './validate-run';

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
    handler(log, C.start, parseRunStart(groupExists), (groupId, configId, size, choice) =>
      run.start(groupId, configId, size, choice),
    ),
  );
  handle(
    C.rerun,
    handler(log, C.rerun, parseRerun(isCommandExecution), (execId, size) => run.rerun(execId, size)),
  );
  handle(
    C.saveConfig,
    handler(log, C.saveConfig, parseSaveConfig(groupExists), (groupId, input) =>
      run.saveConfig(groupId, input),
    ),
  );
  handle(
    C.removeConfig,
    handler(log, C.removeConfig, parseRemoveConfig(groupExists), (groupId, configId) =>
      run.removeConfig(groupId, configId),
    ),
  );
  handle(
    C.reorder,
    handler(log, C.reorder, parseReorder(groupExists), (groupId, items) => run.reorder(groupId, items)),
  );
}
