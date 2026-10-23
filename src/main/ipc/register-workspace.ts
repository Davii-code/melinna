import type { Logger } from '../../core/ports/logger';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import {
  parseCleanResidue,
  parseCreateGroup,
  parseCreateWorkspace,
  parseInspectRepo,
  parseOpenWorkspace,
  parsePickFolders,
  parsePickRepository,
  parseRenameGroup,
  parseRenameTask,
  parseSnapshot,
  parseUpdateWorkspace,
} from './validate-workspace';

export interface WorkspaceIpcDeps {
  workspace: WorkspaceService;
  log: Logger;
  /** Diálogo nativo de escolha de pasta. */
  pickRepository: (defaultPath?: string) => Promise<string | null>;
  /** Diálogo nativo com seleção múltipla de pastas; lista vazia se cancelado. */
  pickFolders: (defaultPath?: string) => Promise<string[]>;
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
    handler(log, C.snapshot, parseSnapshot, async () => {
      await workspace.refreshFolderAvailability();
      return workspace.snapshot();
    }),
  );
  handle(
    C.createGroup,
    handler(log, C.createGroup, parseCreateGroup, (name) => workspace.createGroup(name)),
  );
  handle(
    C.createWorkspace,
    handler(log, C.createWorkspace, parseCreateWorkspace, (input) =>
      workspace.createWorkspace(input.name, input.folders, input.primaryIndex),
    ),
  );
  handle(
    C.updateWorkspace,
    handler(log, C.updateWorkspace, parseUpdateWorkspace(ids), (id, change) =>
      workspace.updateWorkspace(id, change),
    ),
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
    handler(log, C.pickRepository, parsePickRepository, (p) => deps.pickRepository(p)),
  );
  handle(
    C.pickFolders,
    handler(log, C.pickFolders, parsePickFolders, (p) => deps.pickFolders(p)),
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
