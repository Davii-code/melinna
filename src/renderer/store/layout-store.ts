import { useSyncExternalStore } from 'react';
import { gridFor, hasRoomFor } from '../../core/layout/custom';
import { paneOfExecution, paneWithoutTab, type Pane } from '../../core/layout/panes';
import { reorder, swapCells } from '../../core/layout/reorder';
import type { CustomGrid, LayoutMode, LayoutState, MelinnaApi } from '../../shared/ipc-contract';

export const MAX_PANELS = 12;
const SAVE_DEBOUNCE_MS = 200;

export interface LayoutStore {
  get(): LayoutState;
  subscribe(fn: () => void): () => void;
  load(): Promise<LayoutState>;
  /** Abre (ou foca) a execução; a primeira de um painel dá o id do painel. */
  open(execId: string): void;
  /** Abre um arquivo no painel de editor em foco, ou cria um. */
  openDoc(path: string): void;
  close(paneId: string): void;
  focus(paneId: string): void;
  /** Aba ativa de um painel (execução ou arquivo). */
  setActive(paneId: string, index: number): void;
  /** Fecha uma aba; fechar a última aba fecha o painel. */
  closeTab(paneId: string, index: number): void;
  setMode(mode: LayoutMode): void;
  /** Grava as proporções da grade personalizada. */
  setCustom(grid: CustomGrid): void;
  /** Arrastar e soltar: move o painel para a posição do alvo (troca de células na grade personalizada). */
  reorder(fromId: string, toId: string): void;
  /** Foco no próximo (1) ou anterior (-1) painel aberto, em ciclo. */
  cycleFocus(step: 1 | -1): void;
  replace(next: LayoutState): void;
  /** Remove painéis de execuções que não existem mais e abas vazias. */
  prune(known: ReadonlySet<string>): void;
  flush(): Promise<void>;
}

export function defaultLayoutState(): LayoutState {
  return {
    mode: 'auto',
    panes: [],
    focusedPaneId: null,
    custom: { columns: [1], rows: [1], cells: {} },
  };
}

export function paneIds(state: LayoutState): string[] {
  return state.panes.map((pane) => pane.id);
}

/** Painel que já contém a execução, se houver. */
export function paneOf(state: LayoutState, execId: string): Pane | undefined {
  return state.panes.find((pane) => pane.kind === 'executions' && pane.execIds.includes(execId));
}

function withPanes(state: LayoutState, panes: Pane[]): LayoutState {
  const ids = new Set(panes.map((pane) => pane.id));
  const focusedPaneId =
    state.focusedPaneId !== null && ids.has(state.focusedPaneId)
      ? state.focusedPaneId
      : (panes[0]?.id ?? null);
  const cells = Object.fromEntries(Object.entries(state.custom.cells).filter(([key]) => ids.has(key)));
  return { ...state, panes, focusedPaneId, custom: { ...state.custom, cells } };
}

function nextPaneId(state: LayoutState, prefix: string): string {
  const taken = new Set(paneIds(state));
  for (let i = 1; ; i++) {
    const id = `${prefix}-${i}`;
    if (!taken.has(id)) return id;
  }
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

  const closePane = (paneId: string) => {
    if (!state.panes.some((pane) => pane.id === paneId)) return;
    update(withPanes(state, state.panes.filter((pane) => pane.id !== paneId)));
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
      const existing = paneOf(state, execId);
      if (existing) {
        const index = existing.kind === 'executions' ? existing.execIds.indexOf(execId) : 0;
        if (state.focusedPaneId === existing.id && existing.activeIndex === index) return;
        update({
          ...state,
          panes: state.panes.map((pane) =>
            pane.id === existing.id ? { ...pane, activeIndex: index } : pane,
          ),
          focusedPaneId: existing.id,
        });
        return;
      }
      const panes = [...state.panes, paneOfExecution(execId)].slice(-MAX_PANELS);
      update(withPanes({ ...state, focusedPaneId: execId }, panes));
    },
    openDoc(path) {
      const holder = state.panes.find(
        (pane) => pane.kind === 'editor' && pane.docs.includes(path),
      );
      if (holder) {
        update({
          ...state,
          panes: state.panes.map((pane) =>
            pane.id === holder.id
              ? { ...pane, activeIndex: pane.kind === 'editor' ? pane.docs.indexOf(path) : 0 }
              : pane,
          ),
          focusedPaneId: holder.id,
        });
        return;
      }
      const focused = state.panes.find((pane) => pane.id === state.focusedPaneId);
      const target =
        focused?.kind === 'editor'
          ? focused
          : [...state.panes].reverse().find((pane) => pane.kind === 'editor');
      if (target && target.kind === 'editor') {
        const nextDocs = [...target.docs, path];
        update({
          ...state,
          panes: state.panes.map((pane) =>
            pane.id === target.id && pane.kind === 'editor'
              ? { ...pane, docs: nextDocs, activeIndex: nextDocs.length - 1 }
              : pane,
          ),
          focusedPaneId: target.id,
        });
        return;
      }
      const pane: Pane = {
        id: nextPaneId(state, 'editor'),
        kind: 'editor',
        docs: [path],
        activeIndex: 0,
      };
      update(withPanes({ ...state, focusedPaneId: pane.id }, [...state.panes, pane].slice(-MAX_PANELS)));
    },
    close: closePane,
    focus(paneId) {
      if (state.focusedPaneId === paneId) return;
      if (!state.panes.some((pane) => pane.id === paneId)) return;
      update({ ...state, focusedPaneId: paneId });
    },
    setActive(paneId, index) {
      update({
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === paneId ? { ...pane, activeIndex: Math.max(0, index) } : pane,
        ),
      });
    },
    closeTab(paneId, index) {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane) return;
      const next = paneWithoutTab(pane, index);
      if (next === null) {
        closePane(paneId);
        return;
      }
      update({ ...state, panes: state.panes.map((p) => (p.id === paneId ? next : p)) });
    },
    setMode(mode) {
      if (state.mode === mode) return;
      const ids = paneIds(state);
      const needsGrid = mode === 'custom' && !hasRoomFor(state.custom, ids);
      update({ ...state, mode, ...(needsGrid ? { custom: gridFor(ids) } : {}) });
    },
    setCustom(grid) {
      update({ ...state, custom: grid });
    },
    reorder(fromId, toId) {
      if (fromId === toId) return;
      if (state.mode === 'custom') {
        update({ ...state, custom: swapCells(state.custom, fromId, toId) });
        return;
      }
      const ids = paneIds(state);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(toId);
      if (from < 0 || to < 0) return;
      const reordered = reorder(state.panes, from, to);
      update({ ...state, panes: reordered });
    },
    cycleFocus(step) {
      const ids = paneIds(state);
      if (ids.length === 0) return;
      const cur = state.focusedPaneId ? ids.indexOf(state.focusedPaneId) : -1;
      const next = ids[(Math.max(cur, 0) + step + ids.length) % ids.length];
      if (next !== undefined && next !== state.focusedPaneId) update({ ...state, focusedPaneId: next });
    },
    replace(next) {
      update(next);
    },
    prune(known) {
      const panes: Pane[] = [];
      for (const pane of state.panes) {
        if (pane.kind !== 'executions') {
          panes.push(pane);
          continue;
        }
        const execIds = pane.execIds.filter((id) => known.has(id));
        if (execIds.length === 0) continue;
        panes.push({ ...pane, execIds, activeIndex: Math.min(pane.activeIndex, execIds.length - 1) });
      }
      if (panes.length === state.panes.length && panes.every((p, i) => p === state.panes[i])) return;
      update(withPanes(state, panes));
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
