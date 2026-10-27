import { describe, expect, it } from 'vitest';
import { gridFor } from '../../../../src/core/layout/custom';
import { computeRegions, defaultRegions, regionGrid, splitRegion } from '../../../../src/core/layout/regions';
import { emptyState, parseState } from '../../../../src/core/persistence/state-schema';
import { parseLayout } from '../../../../src/main/ipc/validate-layout';

const terminals = ['a', 'b'];
const editors = ['editor-1'];
const regions = () => ({ ...defaultRegions(), terminals: gridFor(terminals), editors: gridFor(editors) });

describe('workspace region geometry and persistence', () => {
  it('places two terminals above a full width editor, without changing panel identity', () => {
    const layout = computeRegions(terminals, editors, { width: 1200, height: 800 }, regions(), 'development');
    expect(layout.rects.map((r) => r.id)).toEqual(['a', 'b', 'editor-1']);
    expect(layout.rects[0]).toMatchObject({ x: 0, y: 0, width: 600, height: 400 });
    expect(layout.rects[1]).toMatchObject({ x: 600, y: 0, width: 600, height: 400 });
    expect(layout.rects[2]).toMatchObject({ x: 0, y: 400, width: 1200, height: 400 });
  });
  it('keeps both editors when focused and hides execution rectangles', () => {
    const r = regions();
    r.editors = splitRegion(r.editors, 'editor-1', 'editor-2', 'right');
    const layout = computeRegions(
      terminals,
      ['editor-1', 'editor-2'],
      { width: 1200, height: 800 },
      r,
      'editor',
    );
    expect(layout.rects).toHaveLength(2);
    expect(layout.rects.every((p) => p.y === 0 && p.height === 800)).toBe(true);
  });
  it('honors right/down splits without overlapping existing cells', () => {
    const down = splitRegion(gridFor(['e1']), 'e1', 'e2', 'down');
    const right = splitRegion(down, 'e1', 'e3', 'right');
    expect(right.columns).toEqual([0.5, 0.5]);
    expect(right.rows).toEqual([0.5, 0.5]);
    expect(right.cells.e2).toEqual({ col: 0, row: 1, colSpan: 2, rowSpan: 1 });
    expect(right.cells.e3).toEqual({ col: 1, row: 0, colSpan: 1, rowSpan: 1 });
  });
  it('scrolls rather than making the editor shorter than 240 px', () => {
    const layout = computeRegions(terminals, editors, { width: 900, height: 300 }, regions(), 'development');
    expect(layout.overflow).toBe(true);
    expect(layout.rects[2]?.height).toBeGreaterThanOrEqual(240);
    expect(layout.rects[0]?.height).toBeGreaterThanOrEqual(200);
  });
  it('expands the remaining panel after closing a split and preserves saved proportions otherwise', () => {
    const grid = splitRegion(gridFor(['e1']), 'e1', 'e2', 'right');
    expect(regionGrid(grid, ['e1', 'e2'])).toEqual(grid);
    expect(regionGrid(grid, ['e1'])).toEqual(gridFor(['e1']));
  });
  it('roundtrips new layout fields and still reads old state', () => {
    const state = emptyState();
    state.layout.mode = 'development';
    state.layout.regions = regions();
    expect(parseState(state)?.layout).toEqual(state.layout);
    expect(parseLayout(state.layout)).toEqual(state.layout);
    delete state.layout.regions;
    expect(parseState(state)?.layout.regions).toBeUndefined();
  });
  it('rejects nonfinite/out of range persisted proportions', () => {
    const layout = { ...emptyState().layout, regions: regions() };
    for (const fraction of [NaN, Infinity, -1, 0, 1]) {
      expect(() =>
        parseLayout({ ...layout, regions: { ...layout.regions, terminalFraction: fraction } }),
      ).toThrow();
    }
  });
});
