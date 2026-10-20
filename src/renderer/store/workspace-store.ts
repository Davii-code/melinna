import { useSyncExternalStore } from 'react';
import type { MelinnaApi, WorkspaceSnapshot } from '../../shared/ipc-contract';

export interface WorkspaceStore {
  get(): WorkspaceSnapshot | null;
  subscribe(fn: () => void): () => void;
  /** Busca o snapshot inicial e passa a seguir `workspace.onChange`. */
  start(): Promise<void>;
  stop(): void;
}

export function createWorkspaceStore(api: MelinnaApi): WorkspaceStore {
  let current: WorkspaceSnapshot | null = null;
  const listeners = new Set<() => void>();
  let off: (() => void) | null = null;
  const set = (s: WorkspaceSnapshot) => {
    if (current && s.version < current.version) return;
    current = s;
    for (const fn of listeners) fn();
  };
  return {
    get: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start() {
      off = api.workspace.onChange(set);
      const r = await api.workspace.snapshot();
      if (r.ok) set(r.value);
    },
    stop() {
      off?.();
      off = null;
    },
  };
}

export function useWorkspace(store: WorkspaceStore): WorkspaceSnapshot | null {
  return useSyncExternalStore(store.subscribe, store.get);
}
