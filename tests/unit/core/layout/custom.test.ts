import { describe, expect, it } from 'vitest';
import { computeCustom, gridFor, moveDivider } from '../../../../src/core/layout/custom';
import type { CustomGrid } from '../../../../src/core/persistence/state-schema';

const AREA = { width: 1000, height: 800 };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('gridFor', () => {
  it('builds a near-square grid with one cell per panel in reading order', () => {
    const g = gridFor(['a', 'b', 'c', 'd', 'e']);
    expect(g.columns).toHaveLength(3);
    expect(g.rows).toHaveLength(2);
    expect(sum(g.columns)).toBeCloseTo(1, 9);
    expect(g.cells.d).toEqual({ col: 0, row: 1, colSpan: 1, rowSpan: 1 });
    expect(gridFor([])).toEqual({ columns: [1], rows: [1], cells: {} });
  });
});

describe('computeCustom', () => {
  it('converts fractions and spans to pixels', () => {
    const grid: CustomGrid = {
      columns: [0.25, 0.75],
      rows: [0.5, 0.5],
      cells: {
        a: { col: 0, row: 0, colSpan: 1, rowSpan: 2 },
        b: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
        c: { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      },
    };
    const r = computeCustom(['a', 'b', 'c'], grid, AREA);
    expect(r.rects).toEqual([
      { id: 'a', x: 0, y: 0, width: 250, height: 800 },
      { id: 'b', x: 250, y: 0, width: 750, height: 400 },
      { id: 'c', x: 250, y: 400, width: 750, height: 400 },
    ]);
    expect(r.overflow).toBe(false);
  });

  it('places panels without a cell in free cells and hides the rest', () => {
    const grid: CustomGrid = {
      columns: [0.5, 0.5],
      rows: [1],
      cells: { b: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } },
    };
    const r = computeCustom(['a', 'b', 'c'], grid, AREA);
    expect(r.rects.map((x) => [x.id, x.x])).toEqual([
      ['a', 0],
      ['b', 500],
    ]);
  });

  it('ignores cells of panels that are not open', () => {
    const grid = gridFor(['x', 'a']);
    expect(computeCustom(['a'], grid, AREA).rects.map((r) => r.id)).toEqual(['a']);
  });
});

describe('moveDivider', () => {
  const grid: CustomGrid = { columns: [0.5, 0.3, 0.2], rows: [1], cells: {} };

  it('moves fraction between neighbour tracks keeping the sum at 1', () => {
    const g = moveDivider(grid, 'col', 0, 0.1, 0.1);
    expect(g.columns[0]).toBeCloseTo(0.6, 9);
    expect(g.columns[1]).toBeCloseTo(0.2, 9);
    expect(g.columns[2]).toBeCloseTo(0.2, 9);
    expect(sum(g.columns)).toBe(1);
    expect(grid.columns).toEqual([0.5, 0.3, 0.2]);
  });

  it('respects the minimum on both sides', () => {
    expect(moveDivider(grid, 'col', 0, 0.5, 0.1).columns.map((x) => Number(x.toFixed(6)))).toEqual([0.7, 0.1, 0.2]);
    expect(moveDivider(grid, 'col', 1, -0.9, 0.15).columns.map((x) => Number(x.toFixed(6)))).toEqual([
      0.5, 0.15, 0.35,
    ]);
  });

  it('works on rows and rejects invalid indexes', () => {
    const g: CustomGrid = { columns: [1], rows: [0.5, 0.5], cells: {} };
    expect(moveDivider(g, 'row', 0, -0.2, 0.1).rows.map((x) => Number(x.toFixed(6)))).toEqual([0.3, 0.7]);
    expect(() => moveDivider(g, 'row', 1, 0.1, 0.1)).toThrow(RangeError);
    expect(() => moveDivider(g, 'col', 0, 0.1, 0.1)).toThrow(RangeError);
    expect(() => moveDivider(g, 'row', -1, 0.1, 0.1)).toThrow(RangeError);
  });
});
