import type { CatalogService } from '../../core/catalog/catalog-service';
import type { ExecutionService } from '../../core/execution/execution-service';
import type { FilesService } from '../../core/files/files-service';
import type { DiffService } from '../../core/git/diff';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import type { CloseFlow } from '../close-flow';
import { registerApp } from './register-app';
import { registerCatalog } from './register-catalog';
import { registerDiff } from './register-diff';
import { registerFiles } from './register-files';
import { registerLayout } from './register-layout';
import { registerLifecycle } from './register-lifecycle';
import { registerSwitch } from './register-switch';
import { registerTasks } from './register-tasks';
import { registerWorkspace } from './register-workspace';
import type { Handle } from './result';
import type { TerminalBridge } from './terminal-ports';

export interface IpcServices {
  catalog: CatalogService;
  workspace: WorkspaceService;
  executions: ExecutionService;
  diff: DiffService;
  files: FilesService;
  model: WorkspaceModel;
  bridge: TerminalBridge;
  closeFlow: CloseFlow;
  log: Logger;
  pickRepository: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
}

/** Compõe o registro dos canais de todos os domínios. */
export function registerIpc(handle: Handle, s: IpcServices): void {
  registerCatalog(handle, { catalog: s.catalog, log: s.log });
  registerWorkspace(handle, { workspace: s.workspace, log: s.log, pickRepository: s.pickRepository });
  registerTasks(handle, { workspace: s.workspace, executions: s.executions, log: s.log });
  registerLifecycle(handle, { executions: s.executions, model: s.model, log: s.log });
  registerDiff(handle, { diff: s.diff, executions: s.executions, model: s.model, log: s.log });
  registerSwitch(handle, { executions: s.executions, model: s.model, log: s.log });
  registerLayout(handle, { model: s.model, files: s.files, log: s.log });
  registerFiles(handle, { files: s.files, log: s.log });
  registerApp(handle, { closeFlow: s.closeFlow, log: s.log, open: s.openExternal });
  s.bridge.register(handle);
}
