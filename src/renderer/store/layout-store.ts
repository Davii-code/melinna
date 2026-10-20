import { useSyncExternalStore } from 'react';
import type { LayoutMode, LayoutState, MelinnaApi } from '../../shared/ipc-contract';

export const MAX_PANELS = 12;
const SAVE_DEBOUNCE_MS = 200;

export interface LayoutStore {
  get(): LayoutState;
  subscribe(fn: () => void): () => void;
  load(): Promise<LayoutState>;
  open(execId: string): void;
  close(execId: string): void;
  focus(execId: string): void;
  setMode(mode: LayoutMode): void;
  replace(next: LayoutState): void;
  /** Remove painéis de execuções que não existem mais. */
  prune(known: ReadonlySet<string>): void;
  flush(): Promise<void>;
}

export function defaultLayoutState(): LayoutState {
  return {
    mode: 'auto',
    openExecutionIds: [],
    focusedExecutionId: null,
    custom: { columns: [1], rows: [1], cells: {} },
  };
}

export function createLayoutStore(
  api: MelinnaApi,
  schedule: (fn: () => void, ms: number) => () => void = defaultSchedule,
): LayoutStore {
  let state = defaultLayoutState();
  const listeners = new Set<() => void>();
  let cancel: (() => void) | null = null;
  let saving: Promise<void> = Promise.resolve();

  const save = () => {
    cancel = null;
    const snapshot = state;
    saving = saving.then(async () => {
      await api.layout.set(snapshot);
    });
  };
  const update = (next: LayoutState) => {
    if (next === state) return;
    state = next;
    for (const fn of listeners) fn();
    cancel?.();
    cancel = schedule(save, SAVE_DEBOUNCE_MS);
  };

  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async load() {
      const r = await api.layout.get();
      if (r.ok) {
        state = r.value;
        for (const fn of listeners) fn();
      }
      return state;
    },
    open(execId) {
      if (state.openExecutionIds.includes(execId)) {
        if (state.focusedExecutionId !== execId) update({ ...state, focusedExecutionId: execId });
        return;
      }
      const ids = [...state.openExecutionIds, execId].slice(-MAX_PANELS);
      update({ ...state, openExecutionIds: ids, focusedExecutionId: execId });
    },
    close(execId) {
      if (!state.openExecutionIds.includes(execId)) return;
      const ids = state.openExecutionIds.filter((x) => x !== execId);
      const cells = Object.fromEntries(Object.entries(state.custom.cells).filter(([k]) => k !== execId));
      update({
        ...state,
        openExecutionIds: ids,
        focusedExecutionId: state.focusedExecutionId === execId ? (ids[0] ?? null) : state.focusedExecutionId,
        custom: { ...state.custom, cells },
      });
    },
    focus(execId) {
      if (state.focusedExecutionId !== execId && state.openExecutionIds.includes(execId))
        update({ ...state, focusedExecutionId: execId });
    },
    setMode(mode) {
      if (state.mode !== mode) update({ ...state, mode });
    },
    replace(next) {
      update(next);
    },
    prune(known) {
      const ids = state.openExecutionIds.filter((x) => known.has(x));
      if (ids.length !== state.openExecutionIds.length) {
        update({
          ...state,
          openExecutionIds: ids,
          focusedExecutionId:
            state.focusedExecutionId && known.has(state.focusedExecutionId)
              ? state.focusedExecutionId
              : (ids[0] ?? null),
        });
      }
    },
    async flush() {
      if (cancel) {
        cancel();
        save();
      }
      await saving;
    },
  };
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

export function useLayout(store: LayoutStore): LayoutState {
  return useSyncExternalStore(store.subscribe, store.get);
}
