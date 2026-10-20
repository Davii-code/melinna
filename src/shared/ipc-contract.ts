// Contrato da API `window.melinna` (contracts/ipc.md). Só tipos e constantes: compartilhado por main, preload e renderer.
import type {
  AgentPick,
  DetectResult,
  DiffResult,
  LaunchResult,
  RemovalCheck,
  RepoInspection,
  SwitchKind,
  SwitchPlan,
  TermSize,
  WorkspaceSnapshot,
} from '../core/api-types';
import type { AgentDefinition, CatalogIssue } from '../core/catalog/schema';
import type { MarkerKind } from '../core/contracts/host-protocol';
import type { ErrorCode } from '../core/errors';
import type { Group, LayoutState } from '../core/persistence/state-schema';

export type {
  AgentDefinition,
  AgentPick,
  CatalogIssue,
  DetectResult,
  DiffResult,
  Group,
  LaunchResult,
  LayoutState,
  MarkerKind,
  RemovalCheck,
  RepoInspection,
  SwitchKind,
  SwitchPlan,
  TermSize,
  WorkspaceSnapshot,
};
export type { DiffLine, FileDiff, Hunk } from '../core/api-types';
export type {
  CustomGrid,
  Execution,
  ExecutionStatus,
  LayoutMode,
  Task,
} from '../core/persistence/state-schema';

export interface ResultError {
  code: ErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ResultError };

export type Unsubscribe = () => void;

export interface CreateAndLaunchInput {
  groupId: string;
  repoPath: string;
  baseRef: string;
  prompt: string;
  title?: string;
  picks: AgentPick[];
  size: TermSize;
}

export type CloseChoice = 'keep-running' | 'stop-all' | 'cancel';

export interface MelinnaApi {
  catalog: {
    list(): Promise<Result<{ agents: AgentDefinition[]; invalid: CatalogIssue[] }>>;
    detectAll(): Promise<Result<Record<string, DetectResult>>>;
  };
  workspace: {
    snapshot(): Promise<Result<WorkspaceSnapshot>>;
    cleanResidue(residuePath: string): Promise<Result<void>>;
    onChange(fn: (s: WorkspaceSnapshot) => void): Unsubscribe;
    createGroup(name: string): Promise<Result<Group>>;
    renameGroup(id: string, name: string): Promise<Result<void>>;
    renameTask(id: string, title: string): Promise<Result<void>>;
    pickRepository(): Promise<Result<string | null>>;
    inspectRepo(repoPath: string, baseRef: string): Promise<Result<RepoInspection>>;
  };
  tasks: {
    createAndLaunch(
      input: CreateAndLaunchInput,
    ): Promise<Result<{ taskId: string; results: LaunchResult[] }>>;
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
  app: {
    onCloseRequested(fn: (info: { liveCount: number }) => void): Unsubscribe;
    answerClose(choice: CloseChoice): Promise<Result<void>>;
    openExternal(url: string): Promise<Result<void>>;
  };
}

/** Canais de `ipcRenderer.invoke`, por método da API. */
export const CHANNELS = {
  catalog: { list: 'catalog:list', detectAll: 'catalog:detectAll' },
  workspace: {
    snapshot: 'workspace:snapshot',
    cleanResidue: 'workspace:cleanResidue',
    createGroup: 'workspace:createGroup',
    renameGroup: 'workspace:renameGroup',
    renameTask: 'workspace:renameTask',
    pickRepository: 'workspace:pickRepository',
    inspectRepo: 'workspace:inspectRepo',
  },
  tasks: { createAndLaunch: 'tasks:createAndLaunch' },
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
  app: { answerClose: 'app:answerClose', openExternal: 'app:openExternal' },
} as const;

/** Eventos do principal para a página (`webContents.send` / `postMessage`). */
export const EVENTS = {
  workspaceChanged: 'workspace:changed',
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
  groupName: 80,
  taskTitle: 120,
  inputBytes: 64 * 1024,
  cols: { min: 20, max: 1000 },
  rows: { min: 5, max: 500 },
  path: 4096,
  baseRef: 256,
  modelOrMode: 100,
  urlLength: 2048,
} as const;
