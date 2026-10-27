import type { Pane } from '../layout/panes';
import { paneOfExecution } from '../layout/panes';
import type { ExecutionCommand, RunConfig } from '../run/types';

export type { Pane };
export { paneOfExecution };

export const STATE_SCHEMA_VERSION = 4;

/** Pasta de um workspace; `path` é absoluto e normalizado. */
export interface WorkspaceFolder {
  id: string;
  path: string;
}

/** Grupo de tarefas; com `folders`, é um workspace com uma ou mais pastas. */
export interface Group {
  id: string;
  name: string;
  order: number;
  /** Pastas do workspace, na ordem em que foram adicionadas; ausente = grupo manual, sem pasta. */
  folders?: WorkspaceFolder[];
  /** Id da pasta principal (onde os terminais rodam); obrigatório quando há `folders`. */
  primaryFolderId?: string;
  /** Derivado da pasta principal; mantido para quem lê o estado sem conhecer `folders`. */
  repoPath?: string;
  /** Derivado da pasta principal. */
  repoId?: string;
  /** Índice da faixa de cor do workspace (0..5). */
  colorIndex?: number;
  lastOpenedAt?: string;
  /** Configurações de execução salvas do workspace (esquema 4); ausente = nenhuma. */
  runConfigs?: RunConfig[];
}

/**
 * Onde as execuções da tarefa rodam: `direct` na própria pasta (qualquer pasta, git ou não);
 * `worktree` num git worktree isolado sob a pasta de dados do app.
 */
export type Isolation = 'worktree' | 'direct';

export interface Task {
  id: string;
  groupId: string;
  title: string;
  prompt: string;
  /** Pasta da tarefa: raiz do repositório ou, em `direct` fora do git, a própria pasta escolhida. */
  repoPath: string;
  repoId: string;
  baseRef: string;
  /** Vazio em `direct`: não há commit base a preservar. */
  baseCommit: string;
  slug: string;
  createdAt: string;
  /** Próximo índice de faixa; execuções removidas não liberam o índice. */
  nextBandIndex?: number;
  /** Ausente = `worktree` (estado gravado antes da execução direta). */
  isolation?: Isolation;
  /** Pastas extras do workspace no momento da criação; ausente = nenhuma. O relançamento reusa a lista. */
  extraDirs?: string[];
  /** Ausente = `agent`; `command` agrupa a execução de um comando de projeto. */
  kind?: 'agent' | 'command';
}

export function isDirect(task: Pick<Task, 'isolation'>): boolean {
  return task.isolation === 'direct';
}

export type ExecutionStatus =
  'preparing' | 'starting' | 'running' | 'idle' | 'exited' | 'failed_to_start' | 'lost';

export interface PendingSwitch {
  kind: 'model' | 'permission';
  value: string;
}

/** Aviso do lançamento sobre as pastas extras do workspace. */
export type ExecutionNotice =
  { kind: 'extra-dirs-unsupported' } | { kind: 'extra-dirs-omitted'; count: number };

export interface Execution {
  id: string;
  taskId: string;
  agentId: string;
  bandIndex: number;
  model: string | null;
  permissionMode: string | null;
  branch: string;
  worktreePath: string;
  baseCommit: string;
  status: ExecutionStatus;
  pendingSwitch: PendingSwitch | null;
  pid: number | null;
  exitCode: number | null;
  signal: string | null;
  startedAt: string | null;
  endedAt: string | null;
  launchCount: number;
  failure: { code: string; message: string } | null;
  /** Avisos do último lançamento; ausente = nenhum. */
  notices?: ExecutionNotice[];
  /** Presente só nas execuções de comando; ausente = execução de agente. */
  command?: ExecutionCommand;
}

export function isCommandExecution(exec: Pick<Execution, 'command'>): exec is Pick<Execution, 'command'> & {
  command: ExecutionCommand;
} {
  return exec.command !== undefined;
}

export type LayoutMode = 'auto' | 'spotlight' | 'sidebar' | 'custom' | 'terminals' | 'development';

export interface CustomCell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface CustomGrid {
  columns: number[];
  rows: number[];
  cells: Record<string, CustomCell>;
}

export interface LayoutState {
  mode: LayoutMode;
  panes: Pane[];
  focusedPaneId: string | null;
  custom: CustomGrid;
  /** Region geometry, optional for compatibility with existing state. */
  regions?: { terminalFraction: number; terminals: CustomGrid; editors: CustomGrid };
}

export interface StateFile {
  schemaVersion: number;
  groups: Group[];
  tasks: Task[];
  executions: Execution[];
  layout: LayoutState;
}

export function defaultLayout(): LayoutState {
  return {
    mode: 'auto',
    panes: [],
    focusedPaneId: null,
    custom: { columns: [1], rows: [1], cells: {} },
  };
}

export function emptyState(): StateFile {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    groups: [],
    tasks: [],
    executions: [],
    layout: defaultLayout(),
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const LAYOUT_MODES: readonly LayoutMode[] = [
  'auto',
  'spotlight',
  'sidebar',
  'custom',
  'terminals',
  'development',
];

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function parsePane(raw: unknown): Pane | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  const index =
    typeof raw.activeIndex === 'number' && Number.isInteger(raw.activeIndex) ? raw.activeIndex : 0;
  if (raw.kind === 'executions') {
    const execIds = strings(raw.execIds);
    if (execIds.length === 0) return null;
    return { id: raw.id, kind: 'executions', execIds, activeIndex: clampIndex(index, execIds.length) };
  }
  if (raw.kind === 'editor') {
    const docs = strings(raw.docs);
    if (docs.length === 0) return null;
    return { id: raw.id, kind: 'editor', docs, activeIndex: clampIndex(index, docs.length) };
  }
  return null;
}

function clampIndex(index: number, length: number): number {
  if (index < 0) return 0;
  return index >= length ? length - 1 : index;
}

function parseCustom(raw: unknown, fallback: CustomGrid): CustomGrid {
  if (!isObj(raw)) return fallback;
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows) || !isObj(raw.cells)) return fallback;
  const columns = raw.columns.filter((n): n is number => typeof n === 'number' && n > 0);
  const rows = raw.rows.filter((n): n is number => typeof n === 'number' && n > 0);
  if (columns.length === 0 || rows.length === 0) return fallback;
  return { columns, rows, cells: raw.cells as unknown as CustomGrid['cells'] };
}

/** Layout antigo (esquema 1): lista de execuções abertas, sem painéis tipados. */
function migrateV1(layout: Record<string, unknown>, fallback: CustomGrid): LayoutState {
  const ids = strings(layout.openExecutionIds);
  const panes = ids.map(paneOfExecution);
  const focused = typeof layout.focusedExecutionId === 'string' ? layout.focusedExecutionId : null;
  return {
    mode: LAYOUT_MODES.includes(layout.mode as LayoutMode) ? (layout.mode as LayoutMode) : 'auto',
    panes,
    focusedPaneId: focused !== null && ids.includes(focused) ? focused : (panes[0]?.id ?? null),
    custom: parseCustom(layout.custom, fallback),
  };
}

function parseLayoutV2(layout: Record<string, unknown>, fallback: CustomGrid): LayoutState {
  const rawPanes = Array.isArray(layout.panes) ? layout.panes : [];
  const panes: Pane[] = [];
  const seen = new Set<string>();
  for (const raw of rawPanes) {
    const pane = parsePane(raw);
    if (pane === null || seen.has(pane.id)) continue;
    seen.add(pane.id);
    panes.push(pane);
  }
  const focused = typeof layout.focusedPaneId === 'string' ? layout.focusedPaneId : null;
  return {
    mode: LAYOUT_MODES.includes(layout.mode as LayoutMode) ? (layout.mode as LayoutMode) : 'auto',
    panes,
    focusedPaneId: focused !== null && seen.has(focused) ? focused : (panes[0]?.id ?? null),
    custom: parseCustom(layout.custom, fallback),
    ...(isObj(layout.regions)
      ? {
          regions: {
            terminalFraction:
              typeof layout.regions.terminalFraction === 'number' &&
              Number.isFinite(layout.regions.terminalFraction)
                ? Math.max(0.15, Math.min(0.85, layout.regions.terminalFraction))
                : 0.5,
            terminals: parseCustom(layout.regions.terminals, fallback),
            editors: parseCustom(layout.regions.editors, fallback),
          },
        }
      : {}),
  };
}

/**
 * Esquema 2 → 3: todo grupo com `repoPath` vira um workspace de uma pasta, que é a principal. O id da
 * pasta deriva do id do grupo, para a migração dar o mesmo resultado a cada leitura (o esquema também é
 * lido pela interface, que não tem gerador de ids do Node).
 */
function migrateGroup(group: Group): Group {
  if (group.folders !== undefined || typeof group.repoPath !== 'string' || group.repoPath === '')
    return group;
  const folder: WorkspaceFolder = { id: `${group.id}-0`, path: group.repoPath };
  return { ...group, folders: [folder], primaryFolderId: folder.id };
}

/**
 * Esquema 3 → 4: `commands` (comandos personalizados) vira `runConfigs` com a ferramenta `program`, mantendo
 * id, programa, argumentos e pasta; o nome é o antigo rótulo e a ordem, a posição na lista.
 */
export function migrateRunConfigs(group: Group & { commands?: unknown }): Group {
  const { commands, ...rest } = group;
  // Sem `commands`, o grupo já está no formato novo (ou nunca teve comandos): relê sem perder o que há.
  if (!Array.isArray(commands)) return { ...rest, runConfigs: group.runConfigs ?? [] };
  const list = commands;
  const runConfigs: RunConfig[] = [];
  for (const raw of list) {
    if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.program !== 'string') continue;
    runConfigs.push({
      id: raw.id,
      name: typeof raw.label === 'string' ? raw.label : raw.program,
      tool: 'program',
      folder: typeof raw.folder === 'string' ? raw.folder : '',
      script: null,
      program: raw.program,
      args: strings(raw.args),
      runtimeOptions: '',
      env: [],
      beforeLaunch: null,
      allowParallel: false,
      folderGroup: null,
      order: runConfigs.length,
    });
  }
  return { ...rest, runConfigs };
}

/** Validação estrutural do arquivo de estado. Devolve `null` se a forma não confere. */
export function parseState(raw: unknown): StateFile | null {
  if (!isObj(raw)) return null;
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number') return null;
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.tasks) || !Array.isArray(raw.executions)) return null;
  if (!raw.groups.every((g) => isObj(g) && typeof g.id === 'string' && typeof g.name === 'string'))
    return null;
  if (!raw.tasks.every((t) => isObj(t) && typeof t.id === 'string' && typeof t.groupId === 'string'))
    return null;
  if (!raw.executions.every((e) => isObj(e) && typeof e.id === 'string' && typeof e.taskId === 'string'))
    return null;
  const layout = isObj(raw.layout) ? raw.layout : null;
  const base = defaultLayout();
  // Esquema 1 → 2: o arquivo antigo é lido e devolvido já no formato novo; nada é regravado aqui.
  const parsedLayout: LayoutState =
    layout === null
      ? base
      : Array.isArray(layout.panes) && !Array.isArray(layout.openExecutionIds)
        ? parseLayoutV2(layout, base.custom)
        : migrateV1(layout, base.custom);
  return {
    // A versão relatada é a do arquivo lido: o `StateStore` usa isso para abrir em somente-leitura
    // um estado gravado por uma versão mais nova do app. O layout, esse sim, sai sempre migrado.
    schemaVersion,
    groups: (raw.groups as Group[]).map((g) => {
      const v3 = schemaVersion < 3 ? migrateGroup(g) : g;
      return schemaVersion < 4 ? migrateRunConfigs(v3) : v3;
    }),
    tasks: raw.tasks as Task[],
    executions: raw.executions as Execution[],
    layout: parsedLayout,
  };
}
