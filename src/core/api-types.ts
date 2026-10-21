// Tipos públicos do núcleo sem dependência de runtime: compartilhados com a interface por src/shared.
import type { IpcError } from './errors';
import type { Execution, Group, LayoutState, Task } from './persistence/state-schema';

export interface TermSize {
  cols: number;
  rows: number;
}

export interface DetectResult {
  installed: boolean;
  /** Nome ou caminho procurado. */
  searched: string;
  resolvedPath?: string;
  reason?: string;
}

export interface RepoInspection {
  root: string;
  baseCommit: string;
  uncommittedCount: number;
}

export interface AgentPick {
  agentId: string;
  model?: string | null;
  permission?: string | null;
}

export type LaunchResult =
  | { execId: string; agentId: string; ok: true }
  | { execId?: string; agentId: string; ok: false; error: IpcError };

export interface WorkspaceSnapshot {
  version: number;
  groups: readonly Group[];
  tasks: readonly Task[];
  executions: readonly Execution[];
  layout: LayoutState;
  liveCount: number;
  maxLive: number;
  readOnly: boolean;
  /** Execuções cuja gravação de histórico está suspensa (disco cheio ou erro de E/S). */
  scrollbackPaused: readonly { execId: string; reason: 'DISK_FULL' | 'IO_ERROR' }[];
  /** Execuções com saída nos últimos 1,5 s. */
  busy: readonly string[];
}

export interface RemovalCheck {
  uncommittedFiles: number;
  unmergedCommits: number;
  branch: string;
}

export type SwitchKind = 'model' | 'permission';

export type SwitchPlan =
  | { planId: string; kind: 'pty-command'; waitsForIdle: boolean; dangerous: boolean }
  | { planId: string; kind: 'restart-resume'; interruptsResponse: boolean; dangerous: boolean }
  | {
      planId: string;
      kind: 'restart-fresh';
      losesConversation: true;
      interruptsResponse: boolean;
      dangerous: boolean;
    };

export interface DiffLine {
  kind: 'context' | 'add' | 'del';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  /** Linha sem quebra no fim do arquivo (`\ No newline at end of file`) do lado antigo/novo. */
  noNewlineOld?: boolean;
  noNewlineNew?: boolean;
}

export type FileChange = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface FileDiff {
  path: string;
  oldPath?: string;
  change: FileChange;
  binary?: { oldSize: number | null; newSize: number | null };
  hunks: Hunk[];
  lineCount: number;
}

export interface DiffResult {
  files: FileDiff[];
}

export type FileEntryKind = 'file' | 'directory';

/** Entrada de uma pasta do workspace, como o explorador de arquivos mostra. */
export interface FileEntry {
  name: string;
  /** Caminho absoluto. */
  path: string;
  kind: FileEntryKind;
  size: number;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
  /** Verdadeiro quando a pasta tinha mais entradas do que o limite de listagem. */
  truncated: boolean;
}

/** Conteúdo textual de um arquivo, para leitura no explorador. */
export interface FileText {
  path: string;
  /** Vazio quando `binary` ou quando o arquivo passa do limite. */
  content: string;
  size: number;
  binary: boolean;
  /** Verdadeiro quando o conteúdo foi cortado no limite de leitura. */
  truncated: boolean;
  /** SHA-256 do conteúdo lido; o salvamento exige que o arquivo ainda tenha este hash. */
  hash: string;
}

/** Resultado de um salvamento: o arquivo em disco agora tem este hash. */
export interface FileWriteResult {
  path: string;
  size: number;
  hash: string;
}

/** Raiz navegável: o repositório de um workspace ou o worktree de uma execução. */
export interface FileRoot {
  path: string;
  label: string;
  kind: 'workspace' | 'worktree';
  /** Presente quando `kind` é `worktree`. */
  execId?: string;
}
