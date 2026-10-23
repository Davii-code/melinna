import { useSyncExternalStore } from 'react';
import type {
  ActiveRunRef,
  Execution,
  MelinnaApi,
  Result,
  ResultError,
  RunCatalog,
  RunChoice,
  RunCommand,
  RunNeedsConfirm,
  RunStarted,
  WorkspaceSnapshot,
} from '../../shared/ipc-contract';
import { isLiveStatus } from '../labels';

export interface RunState {
  /** `null` até a primeira leitura. */
  catalog: RunCatalog | null;
  /** Configuração ativa guardada nas preferências; pode apontar para uma que não existe mais. */
  active: ActiveRunRef | null;
  /** Wrapper do projeto sem permissão de execução: o usuário escolhe como seguir. */
  confirm: { wrapper: string } | null;
  /** Há um pedido de "Rodar" em andamento. */
  busy: boolean;
}

export interface RunStoreDeps {
  api: MelinnaApi;
  layout: { open(execId: string): void };
  workspace: { get(): WorkspaceSnapshot | null };
  /** Tamanho enviado ao lançar; o painel ajusta depois. */
  size: { cols: number; rows: number };
  onError: (error: ResultError) => void;
}

export interface RunStore {
  get(): RunState;
  subscribe(fn: () => void): () => void;
  /** Lê as preferências e o catálogo. */
  load(): Promise<void>;
  /** Lê de novo o catálogo (abrir o seletor, mudar workspaces ou configurações). */
  refresh(): Promise<void>;
  /** Escolhe a configuração ativa e a grava nas preferências. */
  choose(ref: ActiveRunRef | null): Promise<void>;
  /** Roda a configuração ativa; foca o painel (novo ou já existente). */
  run(): Promise<void>;
  /** Responde ao pedido de confirmação do wrapper; `null` cancela. */
  answerConfirm(choice: RunChoice | null): Promise<void>;
  /** Para e relança a execução da configuração ativa. */
  rerun(): Promise<void>;
  /** Para a execução da configuração ativa. */
  stop(): Promise<void>;
}

export function sameRef(a: ActiveRunRef | null, b: ActiveRunRef | null): boolean {
  return a !== null && b !== null && a.groupId === b.groupId && a.commandId === b.commandId;
}

/** A configuração do catálogo à qual a referência aponta, se ela ainda existe. */
export function commandOf(catalog: RunCatalog | null, ref: ActiveRunRef | null): RunCommand | undefined {
  if (!catalog || !ref) return undefined;
  return catalog.commands.find((c) => c.groupId === ref.groupId && c.id === ref.commandId);
}

/** A execução mais recente da configuração (viva ou encerrada). */
export function executionOfCommand(
  snapshot: WorkspaceSnapshot | null,
  ref: ActiveRunRef | null,
): Execution | undefined {
  if (!snapshot || !ref) return undefined;
  const groupOf = new Map(snapshot.tasks.map((t) => [t.id, t.groupId]));
  return snapshot.executions
    .filter((e) => e.command?.commandId === ref.commandId && groupOf.get(e.taskId) === ref.groupId)
    .at(-1);
}

/** Ids das configurações com execução viva, por workspace (`groupId:commandId`). */
export function runningKeys(snapshot: WorkspaceSnapshot | null): Set<string> {
  const keys = new Set<string>();
  if (!snapshot) return keys;
  const groupOf = new Map(snapshot.tasks.map((t) => [t.id, t.groupId]));
  for (const e of snapshot.executions) {
    if (!e.command || !isLiveStatus(e.status)) continue;
    const groupId = groupOf.get(e.taskId);
    if (groupId) keys.add(`${groupId}:${e.command.commandId}`);
  }
  return keys;
}

export function createRunStore(deps: RunStoreDeps): RunStore {
  const { api, layout, workspace, size, onError } = deps;
  let state: RunState = { catalog: null, active: null, confirm: null, busy: false };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<RunState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };

  /** Mostra o erro; uma configuração que mudou pede um catálogo novo. */
  const fail = (error: ResultError) => {
    onError(error);
    if (error.code === 'COMMAND_STALE') void store.refresh();
  };

  async function start(choice: RunChoice | undefined): Promise<void> {
    const ref = state.active;
    const command = commandOf(state.catalog, ref);
    if (!ref || !command || !command.available) return;
    set({ busy: true });
    try {
      const r: Result<RunStarted | RunNeedsConfirm> = await api.run.start(
        ref.groupId,
        ref.commandId,
        size,
        choice,
      );
      if (!r.ok) return fail(r.error);
      if ('needsConfirm' in r.value) {
        set({ confirm: { wrapper: r.value.wrapper } });
        return;
      }
      set({ confirm: null });
      layout.open(r.value.execId);
    } finally {
      set({ busy: false });
    }
  }

  const store: RunStore = {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async load() {
      const [prefs, list] = await Promise.all([api.prefs.get(), api.run.list()]);
      set({
        active: prefs.ok ? prefs.value.activeRun : null,
        catalog: list.ok ? list.value : { commands: [], warnings: [] },
      });
      if (!list.ok) onError(list.error);
    },
    async refresh() {
      const list = await api.run.list();
      if (list.ok) set({ catalog: list.value });
      else onError(list.error);
    },
    async choose(ref) {
      const previous = state.active;
      set({ active: ref });
      const r = await api.prefs.setActiveRun(ref);
      if (!r.ok) {
        set({ active: previous });
        onError(r.error);
      }
    },
    run: () => start(undefined),
    async answerConfirm(choice) {
      set({ confirm: null });
      if (choice !== null) await start(choice);
    },
    async rerun() {
      const exec = executionOfCommand(workspace.get(), state.active);
      if (!exec || !isLiveStatus(exec.status)) return;
      const r = await api.run.rerun(exec.id, size);
      if (!r.ok) return fail(r.error);
      layout.open(exec.id);
    },
    async stop() {
      const exec = executionOfCommand(workspace.get(), state.active);
      if (!exec || !isLiveStatus(exec.status)) return;
      const r = await api.executions.stop(exec.id);
      if (!r.ok) onError(r.error);
    },
  };
  return store;
}

export function useRun(store: RunStore): RunState {
  return useSyncExternalStore(store.subscribe, store.get);
}
