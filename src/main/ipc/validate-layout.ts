import type { CustomGrid, LayoutState } from '../../shared/ipc-contract';
import { id, int, invalid, isObj, oneOf } from './validate-common';

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
    cells[id(key, 'execução')] = {
      col,
      row,
      colSpan: int(c.colSpan, 'largura da célula', 1, columns.length - col),
      rowSpan: int(c.rowSpan, 'altura da célula', 1, rows.length - row),
    };
  }
  return { columns, rows, cells };
}

export function parseLayout(v: unknown): LayoutState {
  if (!isObj(v)) throw invalid('layout');
  const mode = oneOf(v.mode, 'modo de layout', ['auto', 'spotlight', 'sidebar', 'custom'] as const);
  if (!Array.isArray(v.openExecutionIds) || v.openExecutionIds.length > MAX_OPEN_PANELS)
    throw invalid('painéis abertos');
  const openExecutionIds = v.openExecutionIds.map((x) => id(x, 'execução'));
  if (new Set(openExecutionIds).size !== openExecutionIds.length) throw invalid('painéis repetidos');
  const focusedExecutionId =
    v.focusedExecutionId === null ? null : id(v.focusedExecutionId, 'painel em foco');
  return { mode, openExecutionIds, focusedExecutionId, custom: customGrid(v.custom) };
}

export function parseLayoutSet(args: unknown[]): [LayoutState] {
  return [parseLayout(args[0])];
}
