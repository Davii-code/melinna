import { computeCustom, gridFor } from './custom';
import type { Area, LayoutResult } from './types';
import type { CustomGrid, LayoutState } from '../persistence/state-schema';

export type RegionState = NonNullable<LayoutState['regions']>;
export const emptyGrid = (): CustomGrid => ({ columns: [1], rows: [1], cells: {} });
export const defaultRegions = (): RegionState => ({
  terminalFraction: 0.5,
  terminals: emptyGrid(),
  editors: emptyGrid(),
});

/** Keep resized/split geometry when membership is unchanged; prune closed panes. */
export function regionGrid(saved: CustomGrid, ids: readonly string[]): CustomGrid {
  if (Object.keys(saved.cells).length !== ids.length || !ids.every((id) => saved.cells[id]))
    return gridFor(ids);
  return {
    ...saved,
    cells: Object.fromEntries(Object.entries(saved.cells).filter(([id]) => ids.includes(id))),
  };
}

/** Split a cell by inserting a track; other cells expand across the inserted boundary. */
export function splitRegion(
  grid: CustomGrid,
  source: string,
  created: string,
  direction: 'right' | 'down',
): CustomGrid {
  const cell = grid.cells[source];
  if (!cell) return grid;
  const horizontal = direction === 'right';
  const tracks = horizontal ? grid.columns : grid.rows;
  const start = horizontal ? cell.col : cell.row;
  const span = horizontal ? cell.colSpan : cell.rowSpan;
  const cut = start + span - 1;
  const weight = tracks[cut];
  if (weight === undefined) return grid;
  const nextTracks = [...tracks.slice(0, cut), weight / 2, weight / 2, ...tracks.slice(cut + 1)];
  const cells: CustomGrid['cells'] = {};
  for (const [id, old] of Object.entries(grid.cells)) {
    const pos = horizontal ? old.col : old.row;
    const length = horizontal ? old.colSpan : old.rowSpan;
    const nextPos = pos > cut ? pos + 1 : pos;
    const nextSpan = pos <= cut && pos + length > cut ? length + 1 : length;
    cells[id] = horizontal
      ? { ...old, col: nextPos, colSpan: nextSpan }
      : { ...old, row: nextPos, rowSpan: nextSpan };
  }
  const target = cells[source];
  if (!target) return grid;
  cells[source] = horizontal ? { ...target, colSpan: span } : { ...target, rowSpan: span };
  cells[created] = horizontal
    ? { ...target, col: start + span, colSpan: 1 }
    : { ...target, row: start + span, rowSpan: 1 };
  return {
    columns: horizontal ? nextTracks : grid.columns,
    rows: horizontal ? grid.rows : nextTracks,
    cells,
  };
}

export function computeRegions(
  terminalIds: string[],
  editorIds: string[],
  area: Area,
  regions: RegionState,
  presentation: 'terminals' | 'development' | 'editor',
): LayoutResult {
  const onlyEditors =
    presentation === 'editor' || (presentation === 'development' && terminalIds.length === 0);
  const showEditors = presentation !== 'terminals' && editorIds.length > 0;
  const showTerminals = !onlyEditors && terminalIds.length > 0;
  const both = showEditors && showTerminals;
  const minTermHeight = 200 / Math.min(...regions.terminals.rows);
  const minEditHeight = 240 / Math.min(...regions.editors.rows);
  const height = Math.max(
    area.height,
    both ? minTermHeight + minEditHeight : showEditors ? minEditHeight : minTermHeight,
  );
  const terminalHeight = both
    ? Math.max(minTermHeight, Math.min(height - minEditHeight, height * regions.terminalFraction))
    : showTerminals
      ? height
      : 0;
  const terminals = showTerminals
    ? computeCustom(terminalIds, regions.terminals, { width: area.width, height: terminalHeight }).rects
    : [];
  const editors = showEditors
    ? computeCustom(editorIds, regions.editors, {
        width: area.width,
        height: height - terminalHeight,
      }).rects.map((r) => ({ ...r, y: r.y + terminalHeight }))
    : [];
  return { rects: [...terminals, ...editors], contentHeight: height, overflow: height > area.height };
}
