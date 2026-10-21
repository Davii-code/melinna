import { describe, expect, it } from 'vitest';
import { reorder, swapCells } from '../../../../src/core/layout/reorder';
import type { CustomGrid } from '../../../../src/core/persistence/state-schema';

describe('reorder', () => {
  it('moves an item forward and backward without mutating the input', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(reorder(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorder(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(reorder(ids, 1, 1)).toEqual(ids);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns a copy unchanged for out-of-range positions', () => {
    const ids = ['a', 'b'];
    expect(reorder(ids, 5, 0)).toEqual(['a', 'b']);
    expect(reorder(ids, 0, -1)).toEqual(['a', 'b']);
    expect(reorder(ids, 0, 9)).not.toBe(ids);
  });
});

describe('swapCells', () => {
  const grid: CustomGrid = {
    columns: [0.5, 0.5],
    rows: [1],
    cells: {
      a: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      b: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
    },
  };

  it('swaps the cells of two panels', () => {
    const g = swapCells(grid, 'a', 'b');
    expect(g.cells.a).toEqual(grid.cells.b);
    expect(g.cells.b).toEqual(grid.cells.a);
    expect(grid.cells.a?.col).toBe(0);
  });

  it('moves a panel into the cell of one without a previous cell', () => {
    const g = swapCells(grid, 'c', 'a');
    expect(g.cells.c).toEqual(grid.cells.a);
    expect(g.cells.a).toBeUndefined();
  });
});
