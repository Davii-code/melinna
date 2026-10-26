import { useSyncExternalStore } from 'react';
import type {
  ActiveRunRef,
  Execution,
  MelinnaApi,
  Result,
  ResultError,
  RunChoice,
  RunCommand,
  RunConfigInput,
  RunConfigView,
  RunNeedsConfirm,
  RunReorderItem,
  RunStarted,
  RunWarning,
  WorkspaceSnapshot,
} from '../../shared/ipc-contract';
import { copyName } from '../../shared/run-names';
import { isLiveStatus } from '../labels';

export interface RunState {
  /** Configurações salvas de todos os workspaces; `null` até a primeira leitura. */
  configs: RunConfigView[] | null;
  /** Scripts detectados nas pastas: só a origem para criar uma configuração salva. */
  detected: RunCommand[];
  warnings: RunWarning[];
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
  /** Lê as preferências e as configurações. */
  load(): Promise<void>;
  /** Lê de novo as configurações (abrir o seletor, mudar workspaces ou configurações). */
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
  /** Cria ou edita uma configuração salva; a ativa é preservada. Devolve a configuração gravada. */
  save(groupId: string, input: RunConfigInput): Promise<RunConfigView | null>;
  /** Remove uma configuração; se era a ativa, a ativa passa a nenhuma. */
  remove(groupId: string, configId: string): Promise<boolean>;
  /** Grava pasta de agrupamento e posição das configurações listadas. */
  reorder(groupId: string, items: RunReorderItem[]): Promise<boolean>;
  /** Cria uma configuração salva a partir de um script detectado, torna-a a ativa e a devolve. */
  addFromDetected(command: RunCommand): Promise<RunConfigView | null>;
  /** Cancela o "antes de lançar" em andamento: para as etapas vivas da cadeia da configuração ativa. */
  cancelBeforeLaunch(): Promise<void>;
}

export function sameRef(a: ActiveRunRef | null, b: ActiveRunRef | null): boolean {
  return a !== null && b !== null && a.groupId === b.groupId && a.commandId === b.commandId;
}

/** A configuração salva à qual a referência aponta, se ela ainda existe. */
export function configOf(
  configs: RunConfigView[] | null,
  ref: ActiveRunRef | null,
): RunConfigView | undefined {
  if (!configs || !ref) return undefined;
  return configs.find((c) => c.groupId === ref.groupId && c.id === ref.commandId);
}

/** As etapas de "antes de lançar" da configuração, da mais próxima à mais distante (sem a própria). */
export function stepsOf(configs: RunConfigView[] | null, config: RunConfigView): RunConfigView[] {
  const steps: RunConfigView[] = [];
  const seen = new Set<string>([config.id]);
  let next = config.beforeLaunch;
  while (next !== null && configs) {
    const step: RunConfigView | undefined = configs.find(
      (c) => c.groupId === config.groupId && c.id === next,
    );
    if (!step || seen.has(step.id)) break;
    seen.add(step.id);
    steps.push(step);
    next = step.beforeLaunch;
  }
  return steps;
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

/** As execuções vivas da configuração. */
export function liveExecutionsOf(
  snapshot: WorkspaceSnapshot | null,
  groupId: string,
  configId: string,
): Execution[] {
  if (!snapshot) return [];
  const groupOf = new Map(snapshot.tasks.map((t) => [t.id, t.groupId]));
  return snapshot.executions.filter(
    (e) => e.command?.commandId === configId && groupOf.get(e.taskId) === groupId && isLiveStatus(e.status),
  );
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

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p !== '');
  return parts.at(-1) ?? path;
}

/** Dados de uma configuração salva a partir do que a detecção achou; o nome evita repetir um existente. */
export function inputFromDetected(command: RunCommand, existingNames: readonly string[]): RunConfigInput {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  let name = command.label;
  if (taken.has(name.toLowerCase())) name = `${command.label} (${basename(command.folder)})`;
  if (taken.has(name.toLowerCase())) name = copyName(name, existingNames);
  const base: RunConfigInput = {
    name,
    tool: 'program',
    folder: command.folder,
    script: null,
    program: '',
    args: [],
    runtimeOptions: '',
    env: [],
    beforeLaunch: null,
    allowParallel: false,
    folderGroup: null,
  };
  switch (command.tool) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return { ...base, tool: command.tool, script: command.args[1] ?? command.label };
    case 'maven':
    case 'gradle':
      return { ...base, tool: command.tool, script: command.args.join(' ') };
    case 'compose':
      return { ...base, tool: 'compose', args: command.args.filter((a, i) => !(i === 0 && a === 'compose')) };
    default:
      return { ...base, program: command.program, args: command.args };
  }
}

export function createRunStore(deps: RunStoreDeps): RunStore {
  const { api, layout, workspace, size, onError } = deps;
  let state: RunState = {
    configs: null,
    detected: [],
    warnings: [],
    active: null,
    confirm: null,
    busy: false,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<RunState>) => {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  };

  /** Mostra o erro; uma configuração que mudou pede uma leitura nova. */
  const fail = (error: ResultError) => {
    onError(error);
    if (error.code === 'COMMAND_STALE' || error.code === 'RUN_CONFIG_MISSING') void store.refresh();
  };

  async function start(choice: RunChoice | undefined): Promise<void> {
    const ref = state.active;
    const config = configOf(state.configs, ref);
    if (!ref || !config || !config.available) return;
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
        ...(list.ok
          ? { configs: list.value.configs, detected: list.value.detected, warnings: list.value.warnings }
          : { configs: [], detected: [], warnings: [] }),
      });
      if (!list.ok) onError(list.error);
    },
    async refresh() {
      const list = await api.run.list();
      if (list.ok) {
        set({ configs: list.value.configs, detected: list.value.detected, warnings: list.value.warnings });
      } else onError(list.error);
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
    async save(groupId, input) {
      const r = await api.run.saveConfig(groupId, input);
      if (!r.ok) {
        onError(r.error);
        return null;
      }
      await store.refresh();
      return r.value;
    },
    async remove(groupId, configId) {
      const r = await api.run.removeConfig(groupId, configId);
      if (!r.ok) {
        onError(r.error);
        return false;
      }
      const active = state.active;
      if (active && active.groupId === groupId && active.commandId === configId) await store.choose(null);
      await store.refresh();
      return true;
    },
    async reorder(groupId, items) {
      const r = await api.run.reorder(groupId, items);
      if (!r.ok) {
        onError(r.error);
        return false;
      }
      await store.refresh();
      return true;
    },
    async addFromDetected(command) {
      const names = (state.configs ?? []).filter((c) => c.groupId === command.groupId).map((c) => c.name);
      const saved = await store.save(command.groupId, inputFromDetected(command, names));
      if (saved) await store.choose({ groupId: saved.groupId, commandId: saved.id });
      return saved;
    },
    async cancelBeforeLaunch() {
      const config = configOf(state.configs, state.active);
      if (!config) return;
      for (const step of stepsOf(state.configs, config)) {
        for (const exec of liveExecutionsOf(workspace.get(), config.groupId, step.id)) {
          const r = await api.executions.stop(exec.id);
          if (!r.ok) onError(r.error);
        }
      }
    },
  };
  return store;
}

export function useRun(store: RunStore): RunState {
  return useSyncExternalStore(store.subscribe, store.get);
}
