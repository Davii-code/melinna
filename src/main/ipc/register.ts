import type { AttachmentService } from '../../core/attachments/attachment-service';
import type { CatalogService } from '../../core/catalog/catalog-service';
import type { ExecutionService } from '../../core/execution/execution-service';
import type { FileStatusService } from '../../core/files/file-status';
import type { FilesService } from '../../core/files/files-service';
import type { DiffService } from '../../core/git/diff';
import type { GitService } from '../../core/git/git-service';
import type { GitProgress } from '../../core/git/git-types';
import type { OsName } from '../../core/ports/platform';
import type { PreferencesStore } from '../../core/prefs/preferences-store';
import type { PromptLibrary } from '../../core/prompts/prompt-library';
import type { PromptQueue } from '../../core/prompts/prompt-queue';
import type { PromptSender } from '../../core/prompts/prompt-sender';
import type { QueueDiscarded } from '../../core/prompts/types';
import type { RunService } from '../../core/run/run-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import type { CloseFlow } from '../close-flow';
import { registerApp } from './register-app';
import { registerAttachments, type ClipboardPort } from './register-attachments';
import { registerCatalog } from './register-catalog';
import { registerDiff } from './register-diff';
import { registerFiles } from './register-files';
import { registerGit } from './register-git';
import { registerLayout } from './register-layout';
import { registerLifecycle } from './register-lifecycle';
import { registerPrefs } from './register-prefs';
import { registerPrompts } from './register-prompts';
import { registerRun } from './register-run';
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
  git: GitService;
  gitRoots: () => string[];
  os: OsName;
  emitGitProgress: (event: GitProgress) => void;
  files: FilesService;
  fileStatus: FileStatusService;
  run: RunService;
  prefs: PreferencesStore;
  model: WorkspaceModel;
  bridge: TerminalBridge;
  closeFlow: CloseFlow;
  log: Logger;
  pickRepository: (defaultPath?: string) => Promise<string | null>;
  pickFolders: (defaultPath?: string) => Promise<string[]>;
  attachments: AttachmentService;
  clipboard: ClipboardPort;
  thumbnail: (bytes: Uint8Array) => string;
  pickImagePaths: () => Promise<string[]>;
  openExternal: (url: string) => Promise<void>;
  prompts: {
    library: PromptLibrary;
    sender: PromptSender;
    queue: PromptQueue;
    emitQueueDiscarded: (e: QueueDiscarded) => void;
  };
}

/** Compõe o registro dos canais de todos os domínios. */
export function registerIpc(handle: Handle, s: IpcServices): void {
  registerCatalog(handle, { catalog: s.catalog, log: s.log });
  registerWorkspace(handle, {
    workspace: s.workspace,
    log: s.log,
    pickRepository: s.pickRepository,
    pickFolders: s.pickFolders,
  });
  registerTasks(handle, { workspace: s.workspace, executions: s.executions, log: s.log });
  registerLifecycle(handle, { executions: s.executions, model: s.model, log: s.log });
  registerDiff(handle, { diff: s.diff, executions: s.executions, model: s.model, log: s.log });
  registerSwitch(handle, { executions: s.executions, model: s.model, log: s.log });
  registerLayout(handle, { model: s.model, files: s.files, log: s.log });
  registerFiles(handle, { files: s.files, status: s.fileStatus, log: s.log });
  registerGit(handle, { git: s.git, roots: s.gitRoots, os: s.os, emit: s.emitGitProgress, log: s.log });
  registerAttachments(handle, {
    attachments: s.attachments,
    executions: s.executions,
    model: s.model,
    catalog: s.catalog,
    clipboard: s.clipboard,
    thumbnail: s.thumbnail,
    pickImagePaths: s.pickImagePaths,
    log: s.log,
  });
  registerPrompts(handle, {
    library: s.prompts.library,
    sender: s.prompts.sender,
    queue: s.prompts.queue,
    emitQueueDiscarded: s.prompts.emitQueueDiscarded,
    model: s.model,
    log: s.log,
  });
  registerRun(handle, { run: s.run, model: s.model, log: s.log });
  registerPrefs(handle, { prefs: s.prefs, model: s.model, log: s.log });
  registerApp(handle, { closeFlow: s.closeFlow, log: s.log, open: s.openExternal });
  s.bridge.register(handle);
}
