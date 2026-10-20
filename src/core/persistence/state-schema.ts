export const STATE_SCHEMA_VERSION = 1;

export interface Group {
  id: string;
  name: string;
  order: number;
}

export interface Task {
  id: string;
  groupId: string;
  title: string;
  prompt: string;
  repoPath: string;
  repoId: string;
  baseRef: string;
  baseCommit: string;
  slug: string;
  createdAt: string;
  /** Próximo índice de faixa; execuções removidas não liberam o índice. */
  nextBandIndex?: number;
}

export type ExecutionStatus =
  'preparing' | 'starting' | 'running' | 'idle' | 'exited' | 'failed_to_start' | 'lost';

export interface PendingSwitch {
  kind: 'model' | 'permission';
  value: string;
}

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
}

export type LayoutMode = 'auto' | 'spotlight' | 'sidebar' | 'custom';

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
  openExecutionIds: string[];
  focusedExecutionId: string | null;
  custom: CustomGrid;
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
    openExecutionIds: [],
    focusedExecutionId: null,
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

/** Validação estrutural do arquivo de estado. Devolve `null` se a forma não confere. */
export function parseState(raw: unknown): StateFile | null {
  if (!isObj(raw)) return null;
  if (typeof raw.schemaVersion !== 'number') return null;
  if (!Array.isArray(raw.groups) || !Array.isArray(raw.tasks) || !Array.isArray(raw.executions)) return null;
  if (!raw.groups.every((g) => isObj(g) && typeof g.id === 'string' && typeof g.name === 'string'))
    return null;
  if (!raw.tasks.every((t) => isObj(t) && typeof t.id === 'string' && typeof t.groupId === 'string'))
    return null;
  if (!raw.executions.every((e) => isObj(e) && typeof e.id === 'string' && typeof e.taskId === 'string'))
    return null;
  const layout = isObj(raw.layout) ? raw.layout : null;
  const base = defaultLayout();
  const parsedLayout: LayoutState =
    layout && Array.isArray(layout.openExecutionIds)
      ? {
          mode: (['auto', 'spotlight', 'sidebar', 'custom'] as const).includes(layout.mode as LayoutMode)
            ? (layout.mode as LayoutMode)
            : 'auto',
          openExecutionIds: layout.openExecutionIds.filter((x): x is string => typeof x === 'string'),
          focusedExecutionId:
            typeof layout.focusedExecutionId === 'string' ? layout.focusedExecutionId : null,
          custom: isObj(layout.custom) ? (layout.custom as unknown as CustomGrid) : base.custom,
        }
      : base;
  return {
    schemaVersion: raw.schemaVersion,
    groups: raw.groups as Group[],
    tasks: raw.tasks as Task[],
    executions: raw.executions as Execution[],
    layout: parsedLayout,
  };
}
