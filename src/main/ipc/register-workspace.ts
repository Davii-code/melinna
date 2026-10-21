import type { Logger } from '../../core/ports/logger';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import {
  parseCleanResidue,
  parseCreateGroup,
  parseInspectRepo,
  parseOpenWorkspace,
  parsePickRepository,
  parseRenameGroup,
  parseRenameTask,
  parseSnapshot,
} from './validate-workspace';

export interface WorkspaceIpcDeps {
  workspace: WorkspaceService;
  log: Logger;
  /** Diálogo nativo de escolha de pasta. */
  pickRepository: () => Promise<string | null>;
}

export function registerWorkspace(handle: Handle, deps: WorkspaceIpcDeps): void {
  const { workspace, log } = deps;
  const C = CHANNELS.workspace;
  const ids = {
    group: (id: string) => workspace.snapshot().groups.some((g) => g.id === id),
    task: (id: string) => workspace.snapshot().tasks.some((t) => t.id === id),
  };
  handle(
    C.snapshot,
    handler(log, C.snapshot, parseSnapshot, () => workspace.snapshot()),
  );
  handle(
    C.createGroup,
    handler(log, C.createGroup, parseCreateGroup, (name) => workspace.createGroup(name)),
  );
  handle(
    C.renameGroup,
    handler(log, C.renameGroup, parseRenameGroup(ids), (id, name) => workspace.renameGroup(id, name)),
  );
  handle(
    C.renameTask,
    handler(log, C.renameTask, parseRenameTask(ids), (id, title) => workspace.renameTask(id, title)),
  );
  handle(
    C.pickRepository,
    handler(log, C.pickRepository, parsePickRepository, () => deps.pickRepository()),
  );
  handle(
    C.inspectRepo,
    handler(log, C.inspectRepo, parseInspectRepo, (p, ref) => workspace.inspectRepo(p, ref)),
  );
  handle(
    C.openWorkspace,
    handler(log, C.openWorkspace, parseOpenWorkspace, (p, name) => workspace.openWorkspace(p, name)),
  );
  handle(
    C.cleanResidue,
    handler(log, C.cleanResidue, parseCleanResidue, (p) => workspace.cleanResidue(p)),
  );
}
