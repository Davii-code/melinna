import type { MelinnaApi, Result, WorkspaceSnapshot } from '../../src/shared/ipc-contract';
import { vi } from 'vitest';

export function snapshot(over: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    version: 1,
    groups: [],
    tasks: [],
    executions: [],
    layout: {
      mode: 'auto',
      openExecutionIds: [],
      focusedExecutionId: null,
      custom: { columns: [1], rows: [1], cells: {} },
    },
    liveCount: 0,
    maxLive: 12,
    readOnly: false,
    scrollbackPaused: [],
    busy: [],
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
} {
  const changeListeners = new Set<(s: WorkspaceSnapshot) => void>();
  const closeListeners = new Set<(i: { liveCount: number }) => void>();
  const api = {
    catalog: { list: vi.fn(() => okR({ agents: [], invalid: [] })), detectAll: vi.fn(() => okR({})) },
    workspace: {
      snapshot: vi.fn(() => okR(snapshot())),
      cleanResidue: vi.fn(() => okR(undefined)),
      openWorkspace: vi.fn((path: string, name?: string) =>
        okR({ id: 'ws-new', name: name ?? path.split(/[\\/]/).pop() ?? 'ws', order: 0, repoPath: path, colorIndex: 0 }),
      ),
      onChange: vi.fn((fn: (s: WorkspaceSnapshot) => void) => {
        changeListeners.add(fn);
        return () => changeListeners.delete(fn);
      }),
      createGroup: vi.fn((name: string) => okR({ id: 'g-new', name, order: 0 })),
      renameGroup: vi.fn(() => okR(undefined)),
      renameTask: vi.fn(() => okR(undefined)),
      pickRepository: vi.fn(() => okR<string | null>('/escolhido')),
      inspectRepo: vi.fn(() => okR({ root: '/repo', baseCommit: 'a'.repeat(40), uncommittedCount: 0 })),
    },
    tasks: { createAndLaunch: vi.fn(() => okR({ taskId: 't1', results: [] })) },
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
      read: vi.fn(() => okR({ path: '/r/a.txt', content: '', size: 0, binary: false, truncated: false })),
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
  };
  return api as unknown as ReturnType<typeof fakeApi>;
}
