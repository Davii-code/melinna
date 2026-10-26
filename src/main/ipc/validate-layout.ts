import { LIMITS, type CustomGrid, type LayoutState, type Pane } from '../../shared/ipc-contract';
import { id, int, invalid, isObj, oneOf, str } from './validate-common';

export const MAX_OPEN_PANELS = 12;
const FRACTION_TOLERANCE = 1e-6;

function fractions(v: unknown, what: string): number[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_OPEN_PANELS) throw invalid(what);
  if (!v.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1)) throw invalid(what);
  const sum = (v as number[]).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > FRACTION_TOLERANCE) throw invalid(`${what} (as frações devem somar 1)`);
  return v as number[];
}

function customGrid(v: unknown): CustomGrid {
  if (!isObj(v) || !isObj(v.cells)) throw invalid('grade personalizada');
  const columns = fractions(v.columns, 'colunas da grade');
  const rows = fractions(v.rows, 'linhas da grade');
  const cells: CustomGrid['cells'] = {};
  const entries = Object.entries(v.cells);
  if (entries.length > MAX_OPEN_PANELS) throw invalid('células da grade');
  for (const [key, c] of entries) {
    if (!isObj(c)) throw invalid('célula da grade');
    const col = int(c.col, 'coluna', 0, columns.length - 1);
    const row = int(c.row, 'linha', 0, rows.length - 1);
    cells[id(key, 'painel')] = {
      col,
      row,
      colSpan: int(c.colSpan, 'largura da célula', 1, columns.length - col),
      rowSpan: int(c.rowSpan, 'altura da célula', 1, rows.length - row),
    };
  }
  return { columns, rows, cells };
}

/** Aba ativa precisa existir dentro do painel; abas repetidas indicam payload forjado. */
function activeIndex(v: unknown, length: number): number {
  return int(v, 'aba ativa', 0, length - 1);
}

function parsePane(v: unknown): Pane {
  if (!isObj(v)) throw invalid('painel');
  const paneId = id(v.id, 'painel');
  if (v.kind === 'executions') {
    if (!Array.isArray(v.execIds) || v.execIds.length === 0 || v.execIds.length > MAX_OPEN_PANELS)
      throw invalid('execuções do painel');
    const execIds = v.execIds.map((x) => id(x, 'execução'));
    if (new Set(execIds).size !== execIds.length) throw invalid('execuções repetidas no painel');
    return {
      id: paneId,
      kind: 'executions',
      execIds,
      activeIndex: activeIndex(v.activeIndex, execIds.length),
    };
  }
  if (v.kind === 'editor') {
    if (!Array.isArray(v.docs) || v.docs.length === 0 || v.docs.length > MAX_OPEN_PANELS)
      throw invalid('arquivos do painel');
    const docs = v.docs.map((x) => str(x, 'caminho do arquivo', 1, LIMITS.path));
    if (new Set(docs).size !== docs.length) throw invalid('arquivos repetidos no painel');
    return { id: paneId, kind: 'editor', docs, activeIndex: activeIndex(v.activeIndex, docs.length) };
  }
  throw invalid('tipo de painel');
}

export function parseLayout(v: unknown): LayoutState {
  if (!isObj(v)) throw invalid('layout');
  const mode = oneOf(v.mode, 'modo de layout', ['auto', 'spotlight', 'sidebar', 'custom'] as const);
  if (!Array.isArray(v.panes) || v.panes.length > MAX_OPEN_PANELS) throw invalid('painéis abertos');
  const panes = v.panes.map(parsePane);
  if (new Set(panes.map((pane) => pane.id)).size !== panes.length) throw invalid('painéis repetidos');
  const focusedPaneId = v.focusedPaneId === null ? null : id(v.focusedPaneId, 'painel em foco');
  return { mode, panes, focusedPaneId, custom: customGrid(v.custom) };
}

export function parseLayoutSet(args: unknown[]): [LayoutState] {
  return [parseLayout(args[0])];
}
