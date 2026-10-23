import type { IpcError } from '../errors';

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict';

export interface Change {
  /** Relativo à raiz do repositório, com `/`. */
  path: string;
  /** Caminho de origem de um renomeado. */
  oldPath?: string;
  kind: ChangeKind;
  /** Informativos: o commit usa a seleção da janela, não o índice. */
  indexChanged: boolean;
  worktreeChanged: boolean;
}

export type RepoState = 'normal' | 'merging' | 'rebasing' | 'cherry-picking' | 'detached';

export interface RepoStatus {
  root: string;
  /** `null` = HEAD solto (detached). */
  branch: string | null;
  head: string;
  upstream: string | null;
  /** `null` sem upstream. */
  ahead: number | null;
  behind: number | null;
  state: RepoState;
  mergeMessage: string | null;
  changes: Change[];
  hasRemote: boolean;
  defaultRemoteBranch: string | null;
  lastFetchAt: string | null;
}

export interface Branch {
  name: string;
  kind: 'local' | 'remote';
  current: boolean;
  upstream?: string;
}

export interface CommitFile {
  path: string;
  oldPath?: string;
  kind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange';
}

export interface Commit {
  sha: string;
  shortSha: string;
  author: string;
  email: string;
  /** ISO 8601. */
  date: string;
  subject: string;
  body: string;
  files: CommitFile[];
}

export type Confirm =
  | 'amend-published'
  | 'push-main'
  | 'checkout-dirty'
  | 'discard'
  | 'set-upstream'
  | 'merge-dirty'
  | 'abort-merge';

export const CONFIRMS: readonly Confirm[] = [
  'amend-published',
  'push-main',
  'checkout-dirty',
  'discard',
  'set-upstream',
  'merge-dirty',
  'abort-merge',
];

export interface NeedsConfirm {
  needsConfirm: Confirm;
  details: {
    files?: { path: string; action?: 'apagar' | 'reverter' }[];
    branch?: string;
    remote?: string;
  };
}

export type OpStarted = { opId: string };

export interface GitProgress {
  opId: string;
  phase: string;
  percent?: number;
  done?: boolean;
  error?: IpcError;
  result?: { conflicts?: string[] };
}

export function isNeedsConfirm(v: unknown): v is NeedsConfirm {
  return typeof v === 'object' && v !== null && 'needsConfirm' in v;
}
