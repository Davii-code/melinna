import type { CustomCell, CustomGrid } from '../persistence/state-schema';
import type { Area, LayoutResult, Rect } from './types';

/** Menor fração que uma linha ou coluna pode ter ao arrastar uma divisória. */
export const MIN_TRACK_FRACTION = 0.08;

function even(n: number): number[] {
  const out = Array.from({ length: n }, () => 1 / n);
  return normalize(out);
}

/** Ajusta a última fração para a soma ser exatamente 1. */
function normalize(tracks: number[]): number[] {
  const out = [...tracks];
  const head = out.slice(0, -1).reduce((a, b) => a + b, 0);
  out[out.length - 1] = 1 - head;
  return out;
}

/** Grade quase quadrada com uma célula por painel, em ordem de leitura. */
export function gridFor(ids: readonly string[]): CustomGrid {
  if (ids.length === 0) return { columns: [1], rows: [1], cells: {} };
  const cols = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / cols);
  const cells: Record<string, CustomCell> = {};
  ids.forEach((id, i) => {
    cells[id] = { col: i % cols, row: Math.floor(i / cols), colSpan: 1, rowSpan: 1 };
  });
  return { columns: even(cols), rows: even(rows), cells };
}

/** Verdadeiro se as células livres da grade bastam para os painéis abertos que ainda não têm célula. */
export function hasRoomFor(grid: CustomGrid, ids: readonly string[]): boolean {
  const assigned = ids.filter((id) => grid.cells[id]);
  let used = 0;
  for (const id of assigned) {
    const cell = grid.cells[id];
    if (cell) used += cell.colSpan * cell.rowSpan;
  }
  return grid.columns.length * grid.rows.length - used >= ids.length - assigned.length;
}

function offsets(tracks: readonly number[], total: number): number[] {
  const out = [0];
  let acc = 0;
  for (const t of tracks) {
    acc += t;
    out.push(Math.round(acc * total));
  }
  out[out.length - 1] = total;
  return out;
}

/**
 * Converte a grade personalizada em retângulos. Painéis abertos sem célula ocupam as células livres em
 * ordem de leitura; os que não couberem ficam fora (ocultos) até o usuário ajustar a grade.
 */
export function computeCustom(ids: readonly string[], grid: CustomGrid, area: Area): LayoutResult {
  const xs = offsets(grid.columns, area.width);
  const ys = offsets(grid.rows, area.height);
  const occupied = new Set<string>();
  const cellOf = new Map<string, CustomCell>();
  for (const id of ids) {
    const c = grid.cells[id];
    if (!c) continue;
    cellOf.set(id, c);
    for (let r = c.row; r < c.row + c.rowSpan; r += 1)
      for (let k = c.col; k < c.col + c.colSpan; k += 1) occupied.add(`${k},${r}`);
  }
  const free: CustomCell[] = [];
  for (let r = 0; r < grid.rows.length; r += 1)
    for (let k = 0; k < grid.columns.length; k += 1)
      if (!occupied.has(`${k},${r}`)) free.push({ col: k, row: r, colSpan: 1, rowSpan: 1 });
  const rects: Rect[] = [];
  for (const id of ids) {
    const c = cellOf.get(id) ?? free.shift();
    if (!c) continue;
    const x0 = xs[c.col] ?? 0;
    const y0 = ys[c.row] ?? 0;
    const x1 = xs[Math.min(c.col + c.colSpan, grid.columns.length)] ?? area.width;
    const y1 = ys[Math.min(c.row + c.rowSpan, grid.rows.length)] ?? area.height;
    rects.push({ id, x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return { rects, contentHeight: area.height, overflow: false };
}

/**
 * Move a divisória `index` (entre as faixas `index` e `index + 1`) em `deltaFraction`, sem deixar nenhuma
 * das duas abaixo de `minFraction`. Devolve uma grade nova; índices inválidos lançam RangeError.
 */
export function moveDivider(
  grid: CustomGrid,
  axis: 'col' | 'row',
  index: number,
  deltaFraction: number,
  minFraction: number,
): CustomGrid {
  const tracks = axis === 'col' ? grid.columns : grid.rows;
  if (!Number.isInteger(index) || index < 0 || index >= tracks.length - 1) {
    throw new RangeError(`divisória ${axis} ${index} inexistente`);
  }
  const a = tracks[index];
  const b = tracks[index + 1];
  if (a === undefined || b === undefined) {
    throw new RangeError(`divisória ${axis} ${index} inexistente`);
  }
  const delta = Math.max(minFraction - a, Math.min(b - minFraction, deltaFraction));
  const next = [...tracks];
  next[index] = a + delta;
  next[index + 1] = b - delta;
  const fixed = normalize(next);
  return axis === 'col' ? { ...grid, columns: fixed } : { ...grid, rows: fixed };
}
