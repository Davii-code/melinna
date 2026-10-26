import type {
  Branch,
  Commit,
  Confirm,
  DroppedFile,
  GitProgress,
  NeedsConfirm,
  RepoStatus,
  ImageCheck,
  ImageRef,
  MelinnaApi,
  Prompt,
  QueueDiscarded,
  QueueItem,
  Result,
  KeymapId,
  Preferences,
  ProjectSearchQuery,
  ProjectSearchResult,
  RunChoice,
  RunConfigInput,
  RunConfigView,
  RunListing,
  RunNeedsConfirm,
  RunReorderItem,
  RunStarted,
  SendResult,
  WorkspaceChange,
  WorkspaceSnapshot,
} from '../../src/shared/ipc-contract';
import { vi } from 'vitest';

export function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    version: 1,
    groups: [],
    tasks: [],
    executions: [],
    layout: {
      mode: 'auto',
      panes: [],
      focusedPaneId: null,
      custom: { columns: [1], rows: [1], cells: {} },
    },
    liveCount: 0,
    maxLive: 12,
    readOnly: false,
    scrollbackPaused: [],
    busy: [],
    folderAvailability: {},
    ...over,
  };
}

export function imageRef(over: Partial<ImageRef> = {}): ImageRef {
  const path = over.path ?? '/data/attachments/e1/1-1.png';
  return {
    path,
    type: 'png',
    bytes: 2048,
    thumbnail: 'data:image/png;base64,AAAA',
    ref: path,
    source: 'clipboard',
    ...over,
  };
}

export function prompt(over: Partial<Prompt> = {}): Prompt {
  const body = over.body ?? 'Revise {{arquivo}}';
  return {
    id: 'p1',
    name: 'Revisar',
    body,
    scope: 'global',
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    variables: [...new Set([...body.matchAll(/{{([A-Za-z0-9_]+)}}/g)].map((m) => m[1]!))],
    ...over,
  };
}

export function repoStatus(over: Partial<RepoStatus> = {}): RepoStatus {
  return {
    root: '/repo',
    branch: 'main',
    head: 'a'.repeat(40),
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    state: 'normal',
    mergeMessage: null,
    changes: [],
    hasRemote: true,
    defaultRemoteBranch: 'main',
    lastFetchAt: null,
    ...over,
  };
}

export const okR = <T>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true, value });

type DeepMock<T> = {
  [K in keyof T]: T[K] extends (...a: infer A) => infer R
    ? ReturnType<typeof vi.fn<(...a: A) => R>>
    : DeepMock<T[K]>;
};

/** API falsa com `vi.fn` em cada método; respostas padrão bem-sucedidas e vazias. */
export function fakeApi(): DeepMock<MelinnaApi> & {
  emitChange(s: WorkspaceSnapshot): void;
  emitClose(liveCount: number): void;
  emitPromptsChange(): void;
  emitQueueDiscarded(e: QueueDiscarded): void;
  emitGitProgress(e: GitProgress): void;
} {
  const changeListeners = new Set<(s: WorkspaceSnapshot) => void>();
  const closeListeners = new Set<(i: { liveCount: number }) => void>();
  const promptListeners = new Set<() => void>();
  const discardListeners = new Set<(e: QueueDiscarded) => void>();
  const gitListeners = new Set<(e: GitProgress) => void>();
  const api = {
    catalog: { list: vi.fn(() => okR({ agents: [], invalid: [] })), detectAll: vi.fn(() => okR({})) },
    workspace: {
      snapshot: vi.fn(() => okR(snapshot())),
      cleanResidue: vi.fn(() => okR(undefined)),
      openWorkspace: vi.fn((path: string, name?: string) =>
        okR({
          id: 'ws-new',
          name: name ?? path.split(/[\\/]/).pop() ?? 'ws',
          order: 0,
          repoPath: path,
          colorIndex: 0,
        }),
      ),
      onChange: vi.fn((fn: (s: WorkspaceSnapshot) => void) => {
        changeListeners.add(fn);
        return () => changeListeners.delete(fn);
      }),
      createGroup: vi.fn((name: string) => okR({ id: 'g-new', name, order: 0 })),
      renameGroup: vi.fn(() => okR(undefined)),
      renameTask: vi.fn(() => okR(undefined)),
      createWorkspace: vi.fn((input: { name: string; folders: string[]; primaryIndex?: number }) =>
        okR({
          id: 'ws-multi',
          name: input.name,
          order: 0,
          folders: input.folders.map((path, i) => ({ id: `f${i}`, path })),
          primaryFolderId: `f${input.primaryIndex ?? 0}`,
          repoPath: input.folders[input.primaryIndex ?? 0] ?? '',
          colorIndex: 0,
        }),
      ),
      updateWorkspace: vi.fn((id: string, _change: WorkspaceChange) =>
        okR({ id, name: 'ws', order: 0, colorIndex: 0 }),
      ),
      pickFolders: vi.fn(() => okR<string[]>(['/escolhida'])),
      pickRepository: vi.fn(() => okR<string | null>('/escolhido')),
      inspectRepo: vi.fn(() => okR({ root: '/repo', baseCommit: 'a'.repeat(40), uncommittedCount: 0 })),
    },
    tasks: {
      createAndLaunch: vi.fn(() => okR({ taskId: 't1', results: [] })),
      addExecution: vi.fn(() => okR([{ execId: 'e-novo', agentId: 'claude', ok: true as const }])),
      remove: vi.fn(() => okR(undefined)),
      removeWorkspace: vi.fn(() => okR(undefined)),
    },
    executions: {
      stop: vi.fn(() => okR(undefined)),
      relaunch: vi.fn(() => okR(undefined)),
      removalCheck: vi.fn(() => okR({ uncommittedFiles: 0, unmergedCommits: 0, branch: 'b' })),
      remove: vi.fn(() => okR(undefined)),
      requestSwitch: vi.fn(() =>
        okR({ planId: 'p1', kind: 'pty-command' as const, waitsForIdle: false, dangerous: false }),
      ),
      confirmSwitch: vi.fn(() => okR(undefined)),
      cancelPendingSwitch: vi.fn(() => okR(undefined)),
      diff: vi.fn(() => okR({ files: [] })),
      divergence: vi.fn(() => okR({ baseAdvancedBy: 0 })),
    },
    terminal: { open: vi.fn(() => okR({ channelId: 'c1' })), close: vi.fn(() => okR(undefined)) },
    layout: { get: vi.fn(() => okR(snapshot().layout)), set: vi.fn(() => okR(undefined)) },
    files: {
      roots: vi.fn(() => okR([])),
      list: vi.fn(() => okR({ path: '/r', entries: [], truncated: false })),
      read: vi.fn(() =>
        okR({
          path: '/r/a.txt',
          content: '',
          size: 0,
          binary: false,
          truncated: false,
          hash: 'a'.repeat(64),
        }),
      ),
      write: vi.fn(() => okR({ path: '/r/a.txt', size: 0, hash: 'b'.repeat(64) })),
      status: vi.fn(() => okR({})),
      searchProject: vi.fn((_query: ProjectSearchQuery) =>
        okR<ProjectSearchResult>({ hits: [], truncated: false, scannedFiles: 0, skipped: 0 }),
      ),
      pathOf: vi.fn((file: DroppedFile) => `/soltos/${file.name}`),
    },
    git: {
      status: vi.fn((_repo: string) => okR(repoStatus())),
      diffFile: vi.fn((_repo: string, path: string) =>
        okR({ path, change: 'modified' as const, hunks: [], lineCount: 0 }),
      ),
      commit: vi.fn(
        (_repo: string, _input: { paths: string[]; message: string; amend: boolean; confirm?: Confirm[] }) =>
          okR<{ sha: string } | NeedsConfirm>({ sha: 'c'.repeat(40) }),
      ),
      discard: vi.fn((_repo: string, _paths: string[], _confirm?: Confirm[]) =>
        okR<void | NeedsConfirm>(undefined),
      ),
      fetch: vi.fn((_repo: string) => okR({ opId: 'op-fetch' })),
      pull: vi.fn((_repo: string, _confirm?: Confirm[]) =>
        okR<{ opId: string } | NeedsConfirm>({ opId: 'op-pull' }),
      ),
      push: vi.fn((_repo: string, _confirm?: Confirm[]) =>
        okR<{ opId: string } | NeedsConfirm>({ opId: 'op-push' }),
      ),
      cancel: vi.fn((_opId: string) => okR(undefined)),
      branches: vi.fn((_repo: string) =>
        okR<Branch[]>([{ name: 'main', kind: 'local', current: true, upstream: 'origin/main' }]),
      ),
      createBranch: vi.fn((_repo: string, _name: string) => okR(undefined)),
      checkout: vi.fn((_repo: string, _branch: string, _confirm?: Confirm[]) =>
        okR<void | NeedsConfirm>(undefined),
      ),
      merge: vi.fn((_repo: string, _branch: string, _confirm?: Confirm[]) =>
        okR<{ conflicts: string[] } | NeedsConfirm>({ conflicts: [] }),
      ),
      abortMerge: vi.fn((_repo: string, _confirm?: Confirm[]) => okR<void | NeedsConfirm>(undefined)),
      markResolved: vi.fn((_repo: string, _paths: string[]) => okR(undefined)),
      log: vi.fn((_repo: string, _skip: number) => okR<Commit[]>([])),
      commitDiff: vi.fn((_repo: string, _sha: string, path: string) =>
        okR({ path, change: 'modified' as const, hunks: [], lineCount: 0 }),
      ),
      fileAtHead: vi.fn((_repo: string, _path: string) =>
        okR<{ text: string } | { missing: true }>({ missing: true }),
      ),
      onProgress: vi.fn((fn: (e: GitProgress) => void) => {
        gitListeners.add(fn);
        return () => gitListeners.delete(fn);
      }),
    },
    attachments: {
      clipboardHasImage: vi.fn(() => okR(false)),
      pasteImage: vi.fn((_execId: string) => okR(imageRef())),
      checkFiles: vi.fn((_execId: string, paths: string[]) =>
        okR<ImageCheck>({ accepted: paths.map((p) => imageRef({ path: p, source: 'file' })), rejected: [] }),
      ),
      pickImages: vi.fn((_execId: string) => okR<ImageCheck>({ accepted: [], rejected: [] })),
      send: vi.fn((_execId: string, _paths: string[]) => okR(undefined)),
    },
    prompts: {
      list: vi.fn((_groupId?: string) => okR<Prompt[]>([])),
      save: vi.fn((input: { id?: string; name: string; body: string; scope: Prompt['scope'] }) =>
        okR(prompt({ ...input, id: input.id ?? 'p-novo' })),
      ),
      duplicate: vi.fn((id: string) => okR(prompt({ id: `${id}-copia` }))),
      remove: vi.fn((_id: string) => okR(undefined)),
      countForGroup: vi.fn((_groupId: string) => okR(0)),
      preview: vi.fn((input: { body: string; execId: string }) => okR(input.body)),
      send: vi.fn((input: { execIds: string[] }) =>
        okR<SendResult[]>(input.execIds.map((execId) => ({ execId, status: 'sent' as const }))),
      ),
      queue: {
        get: vi.fn((_execId: string) => okR<QueueItem[]>([])),
        enqueue: vi.fn((_input: { execId: string; body: string }) => okR<QueueItem[]>([])),
        remove: vi.fn((_execId: string, _itemId: string) => okR<QueueItem[]>([])),
        clear: vi.fn((_execId: string) => okR(undefined)),
      },
      onChange: vi.fn((fn: () => void) => {
        promptListeners.add(fn);
        return () => promptListeners.delete(fn);
      }),
      onQueueDiscarded: vi.fn((fn: (e: QueueDiscarded) => void) => {
        discardListeners.add(fn);
        return () => discardListeners.delete(fn);
      }),
    },
    run: {
      list: vi.fn(() => okR<RunListing>({ configs: [], detected: [], warnings: [] })),
      start: vi.fn(
        (_groupId: string, _configId: string, _size: { cols: number; rows: number }, _choice?: RunChoice) =>
          okR<RunStarted | RunNeedsConfirm>({ taskId: 't-cmd', execId: 'e-cmd', reused: false }),
      ),
      rerun: vi.fn((_execId: string, _size: { cols: number; rows: number }) => okR(undefined)),
      saveConfig: vi.fn((groupId: string, input: RunConfigInput) =>
        okR<RunConfigView>({
          ...input,
          id: input.id ?? 'c-novo',
          order: 0,
          groupId,
          available: true,
          unavailableReason: null,
          searched: input.program,
          running: 0,
        }),
      ),
      removeConfig: vi.fn((_groupId: string, _configId: string) => okR(undefined)),
      reorder: vi.fn((_groupId: string, _items: RunReorderItem[]) => okR(undefined)),
    },
    prefs: {
      get: vi.fn(() => okR<Preferences>({ keymap: 'windows', activeRun: null, readOnly: false })),
      setKeymap: vi.fn((_keymap: KeymapId) => okR(undefined)),
      setActiveRun: vi.fn((_ref: { groupId: string; commandId: string } | null) => okR(undefined)),
    },
    app: {
      onCloseRequested: vi.fn((fn: (i: { liveCount: number }) => void) => {
        closeListeners.add(fn);
        return () => closeListeners.delete(fn);
      }),
      answerClose: vi.fn(() => okR(undefined)),
      openExternal: vi.fn(() => okR(undefined)),
    },
    emitChange: (s: WorkspaceSnapshot) => {
      for (const fn of changeListeners) fn(s);
    },
    emitClose: (liveCount: number) => {
      for (const fn of closeListeners) fn({ liveCount });
    },
    emitPromptsChange: () => {
      for (const fn of promptListeners) fn();
    },
    emitQueueDiscarded: (e: QueueDiscarded) => {
      for (const fn of discardListeners) fn(e);
    },
    emitGitProgress: (e: GitProgress) => {
      for (const fn of gitListeners) fn(e);
    },
  };
  return api as unknown as ReturnType<typeof fakeApi>;
}
