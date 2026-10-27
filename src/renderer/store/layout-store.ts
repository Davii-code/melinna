import { useSyncExternalStore } from 'react';
import { gridFor, hasRoomFor } from '../../core/layout/custom';
import { paneOfExecution, paneWithoutTab, type Pane } from '../../core/layout/panes';
import { defaultRegions, regionGrid, splitRegion } from '../../core/layout/regions';
import { reorder, swapCells } from '../../core/layout/reorder';
import type { CustomGrid, LayoutMode, LayoutState, MelinnaApi } from '../../shared/ipc-contract';

export const MAX_PANELS = 12;
const SAVE_DEBOUNCE_MS = 200;

export interface LayoutStore {
  get(): LayoutState;
  getSaveError(): string | null;
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
  /** Fecha a aba do arquivo no painel (pelo caminho, sobre o estado de agora); sem a aba, nada acontece. */
  closeDoc(paneId: string, path: string): void;
  /**
   * Põe o arquivo no painel na posição pedida e o ativa (reabrir aba fechada). Se o painel já não existe,
   * recria um painel de editor com o mesmo id.
   */
  openDocAt(paneId: string, path: string, index: number): void;
  /**
   * Abre o arquivo num painel de editor novo, ao lado do painel de origem (editor dividido): o mesmo caminho
   * passa a estar em dois painéis. Na grade automática, "à direita" põe o painel logo depois do original e
   * "abaixo", no fim da grade (a linha de baixo). Sem vaga (12 painéis), nada acontece.
   */
  splitDoc(paneId: string, path: string, direction: 'right' | 'down'): void;
  setMode(mode: LayoutMode): void;
  /** Grava as proporções da grade personalizada. */
  setCustom(grid: CustomGrid): void;
  setRegions(regions: NonNullable<LayoutState['regions']>): void;
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

function insertAt(docs: readonly string[], path: string, index: number): string[] {
  const at = Math.max(0, Math.min(index, docs.length));
  return [...docs.slice(0, at), path, ...docs.slice(at)];
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
  let saveError: string | null = null;

  const save = () => {
    cancel = null;
    const snapshot = state;
    saving = saving
      .catch(() => undefined)
      .then(async () => {
        let nextError: string | null = null;
        try {
          const result = await api.layout.set(snapshot);
          if (!result.ok) nextError = result.error.message;
        } catch (err) {
          nextError = err instanceof Error ? err.message : 'Não foi possível salvar o layout.';
        }
        if (saveError !== nextError) {
          saveError = nextError;
          state = { ...state };
          for (const fn of listeners) fn();
        }
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
    update(
      withPanes(
        state,
        state.panes.filter((pane) => pane.id !== paneId),
      ),
    );
  };

  const closeTabAt = (paneId: string, index: number) => {
    const pane = state.panes.find((p) => p.id === paneId);
    if (!pane) return;
    const next = paneWithoutTab(pane, index);
    if (next === null) {
      closePane(paneId);
      return;
    }
    update({ ...state, panes: state.panes.map((p) => (p.id === paneId ? next : p)) });
  };

  return {
    get: () => state,
    getSaveError: () => saveError,
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
      if (state.mode === 'auto' || state.mode === 'terminals') {
        state = { ...state, mode: state.panes.some((p) => p.kind === 'executions') ? 'development' : 'auto' };
      }
      const holder = state.panes.find((pane) => pane.kind === 'editor' && pane.docs.includes(path));
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
    closeTab: closeTabAt,
    closeDoc(paneId, path) {
      const pane = state.panes.find((p) => p.id === paneId);
      if (!pane || pane.kind !== 'editor') return;
      const index = pane.docs.indexOf(path);
      if (index >= 0) closeTabAt(paneId, index);
    },
    splitDoc(paneId, path, direction) {
      const at = state.panes.findIndex((p) => p.id === paneId);
      if (at < 0 || state.panes.length >= MAX_PANELS) return;
      const created: Pane = { id: nextPaneId(state, 'editor'), kind: 'editor', docs: [path], activeIndex: 0 };
      const panes = [...state.panes];
      panes.splice(direction === 'right' ? at + 1 : panes.length, 0, created);
      const regions = state.regions ?? defaultRegions();
      const editors = regionGrid(
        regions.editors,
        state.panes.filter((p) => p.kind === 'editor').map((p) => p.id),
      );
      update(
        withPanes(
          {
            ...state,
            focusedPaneId: created.id,
            mode: state.mode === 'auto' ? 'development' : state.mode,
            regions: { ...regions, editors: splitRegion(editors, paneId, created.id, direction) },
          },
          panes,
        ),
      );
    },
    openDocAt(paneId, path, index) {
      const pane = state.panes.find((p) => p.id === paneId);
      if (pane && pane.kind === 'editor') {
        const present = pane.docs.indexOf(path);
        const docs = present >= 0 ? pane.docs : insertAt(pane.docs, path, index);
        update({
          ...state,
          panes: state.panes.map((p) =>
            p.id === paneId && p.kind === 'editor'
              ? { ...p, docs, activeIndex: present >= 0 ? present : docs.indexOf(path) }
              : p,
          ),
          focusedPaneId: paneId,
        });
        return;
      }
      const id = paneIds(state).includes(paneId) ? nextPaneId(state, 'editor') : paneId;
      const created: Pane = { id, kind: 'editor', docs: [path], activeIndex: 0 };
      update(withPanes({ ...state, focusedPaneId: id }, [...state.panes, created].slice(-MAX_PANELS)));
    },
    setMode(mode) {
      if (state.mode === mode) return;
      const ids = paneIds(state);
      const needsGrid = mode === 'custom' && !hasRoomFor(state.custom, ids);
      const focusedPaneId =
        mode === 'terminals' && state.panes.find((p) => p.id === state.focusedPaneId)?.kind === 'editor'
          ? (state.panes.find((p) => p.kind === 'executions')?.id ?? null)
          : state.focusedPaneId;
      update({ ...state, mode, focusedPaneId, ...(needsGrid ? { custom: gridFor(ids) } : {}) });
    },
    setCustom(grid) {
      update({ ...state, custom: grid });
    },
    setRegions(regions) {
      update({ ...state, regions });
    },
    reorder(fromId, toId) {
      if (state.mode === 'development' || state.mode === 'terminals') {
        const from = state.panes.find((p) => p.id === fromId);
        const to = state.panes.find((p) => p.id === toId);
        if (!from || !to || from.kind !== to.kind) return;
        const key = from.kind === 'editor' ? 'editors' : 'terminals';
        const regions = state.regions ?? defaultRegions();
        const grid = regionGrid(
          regions[key],
          state.panes.filter((p) => p.kind === from.kind).map((p) => p.id),
        );
        update({ ...state, regions: { ...regions, [key]: swapCells(grid, fromId, toId) } });
        return;
      }
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
        const activeIndex = Math.min(pane.activeIndex, execIds.length - 1);
        panes.push(
          execIds.length === pane.execIds.length && activeIndex === pane.activeIndex
            ? pane
            : { ...pane, execIds, activeIndex },
        );
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
