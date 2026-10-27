import type { WorkflowApi } from './workflow-api';
// Contrato da API `window.melinna` (contracts/ipc.md). Só tipos e constantes: compartilhado por main, preload e renderer.
import type {
  AgentPick,
  DetectResult,
  DiffResult,
  DirectoryListing,
  FileEntry,
  FileRoot,
  FileText,
  FileWriteResult,
  LaunchResult,
  RemovalCheck,
  RepoInspection,
  SwitchKind,
  SwitchPlan,
  TermSize,
  WorkspaceChange,
  WorkspaceSnapshot,
} from '../core/api-types';
import type {
  RunChoice,
  RunCommand,
  RunConfig,
  RunConfigInput,
  RunConfigTool,
  RunConfigUnavailableReason,
  RunConfigView,
  RunEnvVar,
  RunListing,
  RunNeedsConfirm,
  RunReorderItem,
  RunSource,
  RunStarted,
  RunTool,
  RunUnavailableReason,
  RunWarning,
} from '../core/run/types';
import { RUN_LIMITS } from '../core/run/limits';
import { KEYMAP_IDS, type ActiveRunRef, type KeymapId, type Preferences } from '../core/prefs/types';
import type { AgentDefinition, CatalogIssue } from '../core/catalog/schema';
import type { ProjectSearchQuery, ProjectSearchResult, SearchHit } from '../core/files/search-types';
import type { FileAtHead } from '../core/git/file-at-head-types';
import type { MarkerKind } from '../core/contracts/host-protocol';
import type { ErrorCode } from '../core/errors';
import type {
  Branch,
  Change,
  Commit,
  Confirm,
  GitProgress,
  NeedsConfirm,
  OpStarted,
  RepoStatus,
} from '../core/git/git-types';
import type { FileChange, FileDiff } from '../core/api-types';
import type {
  Prompt,
  PromptScope,
  QueueDiscarded,
  QueueItem,
  SendInput,
  SendResult,
  SendStatus,
} from '../core/prompts/types';
import type { ExecutionNotice, Group, LayoutState, WorkspaceFolder } from '../core/persistence/state-schema';

export type {
  AgentDefinition,
  AgentPick,
  CatalogIssue,
  DetectResult,
  DiffResult,
  DirectoryListing,
  FileEntry,
  FileRoot,
  FileText,
  FileWriteResult,
  ProjectSearchQuery,
  ProjectSearchResult,
  SearchHit,
  FileAtHead,
  ExecutionNotice,
  Group,
  LaunchResult,
  LayoutState,
  MarkerKind,
  RemovalCheck,
  RepoInspection,
  SwitchKind,
  SwitchPlan,
  TermSize,
  WorkspaceChange,
  WorkspaceFolder,
  WorkspaceSnapshot,
};
export type {
  RunChoice,
  RunCommand,
  RunConfig,
  RunConfigInput,
  RunConfigTool,
  RunConfigUnavailableReason,
  RunConfigView,
  RunEnvVar,
  RunListing,
  RunNeedsConfirm,
  RunReorderItem,
  RunSource,
  RunStarted,
  RunTool,
  RunUnavailableReason,
  RunWarning,
};
export type { DiffLine, FileChange, FileDiff, Hunk } from '../core/api-types';
export type { Branch, Change, Commit, Confirm, GitProgress, NeedsConfirm, OpStarted, RepoStatus };
export type { ChangeKind, CommitFile, RepoState } from '../core/git/git-types';
export type { Prompt, PromptScope, QueueDiscarded, QueueItem, SendInput, SendResult, SendStatus };
export type {
  CustomGrid,
  Execution,
  ExecutionStatus,
  LayoutMode,
  Pane,
  Task,
} from '../core/persistence/state-schema';

/** Imagem pronta para a prévia: o main valida, gera a miniatura e formata a referência do agente. */
export interface ImageRef {
  path: string;
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  bytes: number;
  /** `data:image/png;base64,...` com o lado maior até 256 px. */
  thumbnail: string;
  /** Referência já formatada para o agente da execução (aspas, `@` etc.). */
  ref: string;
  source: 'clipboard' | 'file';
}

export interface ImageCheck {
  accepted: ImageRef[];
  rejected: { path: string; reason: string }[];
}

/** Arquivo solto na página; o preload resolve o caminho real (`webUtils.getPathForFile`). */
export interface DroppedFile {
  readonly name: string;
}

export interface ResultError {
  code: ErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ResultError };

export type Unsubscribe = () => void;

export interface CreateAndLaunchInput {
  profileId?: string;
  checkpointBeforeLaunch?: boolean;
  groupId: string;
  repoPath: string;
  baseRef: string;
  prompt: string;
  title?: string;
  picks: AgentPick[];
  size: TermSize;
}

export type CloseChoice = 'keep-running' | 'stop-all' | 'cancel';

export { KEYMAP_IDS };
export type { ActiveRunRef, KeymapId, Preferences };

export interface MelinnaApi {
  workflow?: WorkflowApi;
  catalog: {
    list(): Promise<Result<{ agents: AgentDefinition[]; invalid: CatalogIssue[] }>>;
    detectAll(): Promise<Result<Record<string, DetectResult>>>;
  };
  workspace: {
    snapshot(): Promise<Result<WorkspaceSnapshot>>;
    cleanResidue(residuePath: string): Promise<Result<void>>;
    /** Abre (ou reaproveita) o workspace da pasta; `name` opcional, padrão = nome da pasta. */
    openWorkspace(path: string, name?: string): Promise<Result<Group>>;
    onChange(fn: (s: WorkspaceSnapshot) => void): Unsubscribe;
    createGroup(name: string): Promise<Result<Group>>;
    /** Cria um workspace com nome e pastas; `primaryIndex` (padrão 0) escolhe a pasta principal. */
    createWorkspace(input: {
      name: string;
      folders: string[];
      primaryIndex?: number;
    }): Promise<Result<Group>>;
    /** Aplica uma mudança (nome ou pastas) e devolve o workspace atualizado; sessões vivas não mudam. */
    updateWorkspace(id: string, change: WorkspaceChange): Promise<Result<Group>>;
    renameGroup(id: string, name: string): Promise<Result<void>>;
    renameTask(id: string, title: string): Promise<Result<void>>;
    /** Diálogo nativo de escolha de pasta; `defaultPath` abre o diálogo nessa pasta. */
    pickRepository(defaultPath?: string): Promise<Result<string | null>>;
    /** Diálogo nativo com seleção múltipla de pastas; lista vazia se cancelado. */
    pickFolders(defaultPath?: string): Promise<Result<string[]>>;
    inspectRepo(repoPath: string, baseRef: string): Promise<Result<RepoInspection>>;
  };
  tasks: {
    createAndLaunch(
      input: CreateAndLaunchInput,
    ): Promise<Result<{ taskId: string; results: LaunchResult[] }>>;
    /** Remove a sessão e as execuções dela (paradas); a pasta no disco não é tocada. */
    /** Abre mais um terminal na sessão, com o agente escolhido e sem o enunciado da sessão. */
    addExecution(taskId: string, pick: AgentPick, size: TermSize): Promise<Result<LaunchResult[]>>;
    remove(taskId: string): Promise<Result<void>>;
    /** Tira o workspace da lista com as sessões dele (paradas); a pasta no disco não é tocada. */
    removeWorkspace(groupId: string): Promise<Result<void>>;
  };
  executions: {
    stop(execId: string): Promise<Result<void>>;
    relaunch(execId: string, size: TermSize): Promise<Result<void>>;
    removalCheck(execId: string): Promise<Result<RemovalCheck>>;
    remove(execId: string, opts: { deleteBranch: boolean; force: boolean }): Promise<Result<void>>;
    requestSwitch(execId: string, kind: SwitchKind, value: string): Promise<Result<SwitchPlan>>;
    confirmSwitch(execId: string, planId: string): Promise<Result<void>>;
    cancelPendingSwitch(execId: string): Promise<Result<void>>;
    diff(execId: string): Promise<Result<DiffResult>>;
    divergence(execId: string): Promise<Result<{ baseAdvancedBy: number }>>;
  };
  terminal: {
    open(execId: string): Promise<Result<{ channelId: string }>>;
    close(execId: string): Promise<Result<void>>;
  };
  layout: {
    get(): Promise<Result<LayoutState>>;
    set(state: LayoutState): Promise<Result<void>>;
  };
  files: {
    /** Raízes navegáveis: repositórios de workspaces abertos e worktrees das execuções. */
    roots(): Promise<Result<FileRoot[]>>;
    list(path: string): Promise<Result<DirectoryListing>>;
    read(path: string): Promise<Result<FileText>>;
    /** Grava só se o hash em disco ainda for o recebido na leitura; senão devolve FILE_CONFLICT. */
    write(path: string, content: string, expectedHash: string): Promise<Result<FileWriteResult>>;
    /** Estado do git por arquivo (caminho relativo à raiz), para decorar a árvore. */
    status(root: string): Promise<Result<Record<string, FileChange>>>;
    /**
     * Busca no projeto (num worker do principal). Uma busca nova cancela a anterior; texto vazio só cancela.
     * As raízes precisam ser as registradas do workspace.
     */
    searchProject(query: ProjectSearchQuery): Promise<Result<ProjectSearchResult>>;
    /** Caminho real de um arquivo solto na página (só o preload sabe resolver). */
    pathOf(file: DroppedFile): string;
  };
  attachments: {
    /** A área de transferência tem imagem e não tem texto? */
    clipboardHasImage(): Promise<Result<boolean>>;
    /** Lê a imagem da área de transferência, grava como anexo da execução e devolve a referência. */
    pasteImage(execId: string): Promise<Result<ImageRef>>;
    /** Valida arquivos soltos ou escolhidos; os recusados vêm em `rejected` com o motivo. */
    checkFiles(execId: string, paths: string[]): Promise<Result<ImageCheck>>;
    /** Diálogo nativo com filtro de imagens (seleção múltipla) seguido de `checkFiles`. */
    pickImages(execId: string): Promise<Result<ImageCheck>>;
    /** Revalida os arquivos e escreve as referências no PTY, separadas por espaço, sem Enter. */
    send(execId: string, paths: string[]): Promise<Result<void>>;
  };
  git: {
    /** `repo` é a raiz de uma pasta de workspace aberta; toda operação é por ação explícita do usuário. */
    status(repo: string): Promise<Result<RepoStatus>>;
    diffFile(repo: string, path: string): Promise<Result<FileDiff>>;
    /** `paths` pode ser vazio só com amend; em merge, exige todos os arquivos. */
    commit(
      repo: string,
      input: { paths: string[]; message: string; amend: boolean; confirm?: Confirm[] },
    ): Promise<Result<{ sha: string } | NeedsConfirm>>;
    discard(repo: string, paths: string[], confirm?: Confirm[]): Promise<Result<void | NeedsConfirm>>;
    fetch(repo: string): Promise<Result<OpStarted>>;
    pull(repo: string, confirm?: Confirm[]): Promise<Result<OpStarted | NeedsConfirm>>;
    push(repo: string, confirm?: Confirm[]): Promise<Result<OpStarted | NeedsConfirm>>;
    cancel(opId: string): Promise<Result<void>>;
    branches(repo: string): Promise<Result<Branch[]>>;
    createBranch(repo: string, name: string): Promise<Result<void>>;
    checkout(repo: string, branch: string, confirm?: Confirm[]): Promise<Result<void | NeedsConfirm>>;
    merge(
      repo: string,
      branch: string,
      confirm?: Confirm[],
    ): Promise<Result<{ conflicts: string[] } | NeedsConfirm>>;
    abortMerge(repo: string, confirm?: Confirm[]): Promise<Result<void | NeedsConfirm>>;
    markResolved(repo: string, paths: string[]): Promise<Result<void>>;
    /** 200 commits por página. */
    log(repo: string, skip: number): Promise<Result<Commit[]>>;
    commitDiff(repo: string, sha: string, path: string): Promise<Result<FileDiff>>;
    /** O arquivo (caminho absoluto dentro da pasta `repo`) como está em `HEAD`; só leitura. */
    fileAtHead(repo: string, path: string): Promise<Result<FileAtHead>>;
    /** Progresso e fim das operações de rede (fetch, pull, push). */
    onProgress(fn: (e: GitProgress) => void): Unsubscribe;
  };
  prompts: {
    /** Prompts globais mais os do workspace; sem `groupId`, só os globais. */
    list(groupId?: string): Promise<Result<Prompt[]>>;
    save(input: { id?: string; name: string; body: string; scope: PromptScope }): Promise<Result<Prompt>>;
    duplicate(id: string): Promise<Result<Prompt>>;
    remove(id: string): Promise<Result<void>>;
    /** Quantos prompts têm o escopo do workspace (para a confirmação de remoção do workspace). */
    countForGroup(groupId: string): Promise<Result<number>>;
    /** Prévia do texto final para uma sessão (não envia). */
    preview(input: Omit<SendInput, 'execIds'> & { execId: string }): Promise<Result<string>>;
    send(input: SendInput): Promise<Result<SendResult[]>>;
    queue: {
      get(execId: string): Promise<Result<QueueItem[]>>;
      /** Resolve para a sessão e enfileira; sessão ociosa com fila vazia envia na hora. */
      enqueue(input: Omit<SendInput, 'execIds'> & { execId: string }): Promise<Result<QueueItem[]>>;
      remove(execId: string, itemId: string): Promise<Result<QueueItem[]>>;
      clear(execId: string): Promise<Result<void>>;
    };
    onChange(fn: () => void): Unsubscribe;
    onQueueDiscarded(fn: (e: QueueDiscarded) => void): Unsubscribe;
  };
  run: {
    /** Configurações salvas de todos os workspaces e os scripts detectados (origem para criar uma salva). */
    list(): Promise<Result<RunListing>>;
    /**
     * O main resolve a configuração pelo id e roda o "antes de lançar" em ordem; se já roda e não permite
     * várias instâncias, devolve a execução existente com `reused`.
     */
    start(
      groupId: string,
      configId: string,
      size: TermSize,
      choice?: RunChoice,
    ): Promise<Result<RunStarted | RunNeedsConfirm>>;
    rerun(execId: string, size: TermSize): Promise<Result<void>>;
    saveConfig(groupId: string, input: RunConfigInput): Promise<Result<RunConfigView>>;
    removeConfig(groupId: string, configId: string): Promise<Result<void>>;
    reorder(groupId: string, items: RunReorderItem[]): Promise<Result<void>>;
  };
  prefs: {
    get(): Promise<Result<Preferences>>;
    setKeymap(keymap: KeymapId): Promise<Result<void>>;
    setActiveRun(ref: ActiveRunRef | null): Promise<Result<void>>;
  };
  app: {
    onCloseRequested(fn: (info: { liveCount: number }) => void): Unsubscribe;
    answerClose(choice: CloseChoice): Promise<Result<void>>;
    openExternal(url: string): Promise<Result<void>>;
  };
}

/** Canais de `ipcRenderer.invoke`, por método da API. */
export const CHANNELS = {
  workflow: {
    snapshot: 'workflow:snapshot',
    saveProfile: 'workflow:saveProfile',
    removeProfile: 'workflow:removeProfile',
    preferences: 'workflow:preferences',
    review: 'workflow:review',
    saveNotes: 'workflow:saveNotes',
    checkpoint: 'workflow:checkpoint',
    diff: 'workflow:diff',
    previewRestore: 'workflow:previewRestore',
    restore: 'workflow:restore',
    draftHandoff: 'workflow:draftHandoff',
    handoff: 'workflow:handoff',
    verify: 'workflow:verify',
    cancelVerification: 'workflow:cancelVerification',
    markRead: 'workflow:markRead',
  },
  catalog: { list: 'catalog:list', detectAll: 'catalog:detectAll' },
  workspace: {
    snapshot: 'workspace:snapshot',
    cleanResidue: 'workspace:cleanResidue',
    openWorkspace: 'workspace:openWorkspace',
    createGroup: 'workspace:createGroup',
    createWorkspace: 'workspace:createWorkspace',
    updateWorkspace: 'workspace:updateWorkspace',
    renameGroup: 'workspace:renameGroup',
    renameTask: 'workspace:renameTask',
    pickRepository: 'workspace:pickRepository',
    pickFolders: 'workspace:pickFolders',
    inspectRepo: 'workspace:inspectRepo',
  },
  tasks: {
    createAndLaunch: 'tasks:createAndLaunch',
    addExecution: 'tasks:addExecution',
    remove: 'tasks:remove',
    removeWorkspace: 'tasks:removeWorkspace',
  },
  executions: {
    stop: 'executions:stop',
    relaunch: 'executions:relaunch',
    removalCheck: 'executions:removalCheck',
    remove: 'executions:remove',
    requestSwitch: 'executions:requestSwitch',
    confirmSwitch: 'executions:confirmSwitch',
    cancelPendingSwitch: 'executions:cancelPendingSwitch',
    diff: 'executions:diff',
    divergence: 'executions:divergence',
  },
  terminal: { open: 'terminal:open', close: 'terminal:close' },
  layout: { get: 'layout:get', set: 'layout:set' },
  files: {
    roots: 'files:roots',
    list: 'files:list',
    read: 'files:read',
    write: 'files:write',
    status: 'files:status',
    searchProject: 'files:searchProject',
  },
  git: {
    status: 'git:status',
    diffFile: 'git:diffFile',
    commit: 'git:commit',
    discard: 'git:discard',
    fetch: 'git:fetch',
    pull: 'git:pull',
    push: 'git:push',
    cancel: 'git:cancel',
    branches: 'git:branches',
    createBranch: 'git:createBranch',
    checkout: 'git:checkout',
    merge: 'git:merge',
    abortMerge: 'git:abortMerge',
    markResolved: 'git:markResolved',
    log: 'git:log',
    commitDiff: 'git:commitDiff',
    fileAtHead: 'git:fileAtHead',
  },
  attachments: {
    clipboardHasImage: 'attachments:clipboardHasImage',
    pasteImage: 'attachments:pasteImage',
    checkFiles: 'attachments:checkFiles',
    pickImages: 'attachments:pickImages',
    send: 'attachments:send',
  },
  prompts: {
    list: 'prompts:list',
    save: 'prompts:save',
    duplicate: 'prompts:duplicate',
    remove: 'prompts:remove',
    countForGroup: 'prompts:countForGroup',
    preview: 'prompts:preview',
    send: 'prompts:send',
  },
  promptQueue: {
    get: 'prompts:queue:get',
    enqueue: 'prompts:queue:enqueue',
    remove: 'prompts:queue:remove',
    clear: 'prompts:queue:clear',
  },
  run: {
    list: 'run:list',
    start: 'run:start',
    rerun: 'run:rerun',
    saveConfig: 'run:saveConfig',
    removeConfig: 'run:removeConfig',
    reorder: 'run:reorder',
  },
  prefs: {
    get: 'prefs:get',
    setKeymap: 'prefs:setKeymap',
    setActiveRun: 'prefs:setActiveRun',
  },
  app: { answerClose: 'app:answerClose', openExternal: 'app:openExternal' },
} as const;

/** Eventos do principal para a página (`webContents.send` / `postMessage`). */
export const EVENTS = {
  workflowChanged: 'workflow:changed',
  workspaceChanged: 'workspace:changed',
  promptsChanged: 'prompts:changed',
  gitProgress: 'git:progress',
  queueDiscarded: 'prompts:queueDiscarded',
  closeRequested: 'app:closeRequested',
  terminalPort: 'terminal:port',
} as const;

/** Mensagem que o preload repassa à página com o MessagePort do terminal. */
export const TERMINAL_PORT_SOURCE = 'melinna-terminal';

export interface TerminalPortEnvelope {
  source: typeof TERMINAL_PORT_SOURCE;
  execId: string;
  channelId: string;
}

/** Principal → página, pelo MessagePort. */
export type TerminalToPage =
  | { type: 'data'; offset: number; bytes: Uint8Array }
  | { type: 'marker'; kind: MarkerKind; lostBytes?: number }
  | { type: 'replay-start' }
  | { type: 'replay-end' }
  | { type: 'exit'; exitCode: number | null; signal: string | null };

/** Página → principal, pelo MessagePort. */
export type TerminalFromPage =
  | { type: 'input'; bytes: Uint8Array }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ack'; offset: number };

export const LIMITS = {
  prompt: 100_000,
  promptName: 80,
  promptValue: 10_000,
  sendTargets: 12,
  groupName: 80,
  taskTitle: 120,
  inputBytes: 64 * 1024,
  cols: { min: 20, max: 1000 },
  rows: { min: 5, max: 500 },
  path: 4096,
  commandLabel: RUN_LIMITS.label,
  commandArgs: RUN_LIMITS.args,
  commandArg: RUN_LIMITS.arg,
  runtimeOptions: RUN_LIMITS.runtimeOptions,
  envPairs: RUN_LIMITS.envPairs,
  envValue: RUN_LIMITS.envValue,
  folderGroup: RUN_LIMITS.folderGroup,
  script: RUN_LIMITS.script,
  reorderItems: 100,
  searchText: 1000,
  searchMask: 500,
  searchRoots: 64,
  baseRef: 256,
  modelOrMode: 100,
  urlLength: 2048,
  fileText: 5 * 1024 * 1024,
  gitPaths: 5000,
  gitMessage: 20_000,
  gitBranchName: 255,
} as const;
