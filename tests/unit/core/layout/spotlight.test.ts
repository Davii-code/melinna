import { describe, expect, it } from 'vitest';
import { computeSidebar, SIDEBAR_FRACTION } from '../../../../src/core/layout/sidebar';
import { computeSpotlight, STRIP_FRACTION } from '../../../../src/core/layout/spotlight';
import type { LayoutResult, Rect } from '../../../../src/core/layout/types';

const WIDE = { width: 1600, height: 900 };
const TALL = { width: 900, height: 1200 };

function byId(r: LayoutResult): Map<string, Rect> {
  return new Map(r.rects.map((x) => [x.id, x]));
}

function expectInside(r: LayoutResult, area: { width: number; height: number }) {
  for (const x of r.rects) {
    expect(x.x).toBeGreaterThanOrEqual(0);
    expect(x.y).toBeGreaterThanOrEqual(0);
    expect(x.x + x.width).toBeLessThanOrEqual(area.width);
    expect(x.y + x.height).toBeLessThanOrEqual(area.height);
  }
}

describe('computeSpotlight', () => {
  it('puts the focused panel large and the strip on the right in a wide window', () => {
    const r = computeSpotlight(['a', 'b', 'c'], 'b', WIDE);
    const m = byId(r);
    const stripW = Math.round(WIDE.width * STRIP_FRACTION);
    expect(m.get('b')).toEqual({ id: 'b', x: 0, y: 0, width: WIDE.width - stripW, height: WIDE.height });
    expect(m.get('a')).toEqual({ id: 'a', x: WIDE.width - stripW, y: 0, width: stripW, height: 450 });
    expect(m.get('c')).toEqual({ id: 'c', x: WIDE.width - stripW, y: 450, width: stripW, height: 450 });
    expect(r.rects[0]?.id).toBe('b');
    expect(r.overflow).toBe(false);
    expectInside(r, WIDE);
  });

  it('puts the strip at the bottom in a tall window', () => {
    const r = computeSpotlight(['a', 'b', 'c'], 'a', TALL);
    const m = byId(r);
    const stripH = Math.round(TALL.height * STRIP_FRACTION);
    expect(m.get('a')).toEqual({ id: 'a', x: 0, y: 0, width: TALL.width, height: TALL.height - stripH });
    expect(m.get('b')).toMatchObject({ x: 0, y: TALL.height - stripH, height: stripH, width: 450 });
    expect(m.get('c')).toMatchObject({ x: 450, y: TALL.height - stripH, height: stripH, width: 450 });
    expectInside(r, TALL);
  });

  it('falls back to the first panel when the focus is not open', () => {
    const r = computeSpotlight(['a', 'b'], 'x', WIDE);
    expect(r.rects[0]?.id).toBe('a');
    expect(computeSpotlight(['a', 'b'], null, WIDE).rects[0]?.id).toBe('a');
  });

  it('uses the whole area for a single panel and nothing for none', () => {
    expect(computeSpotlight(['a'], 'a', WIDE).rects).toEqual([{ id: 'a', x: 0, y: 0, ...WIDE }]);
    expect(computeSpotlight([], null, WIDE)).toEqual({ rects: [], contentHeight: 0, overflow: false });
  });
});

describe('computeSidebar', () => {
  it('keeps the main panel on the left and stacks the others in a right column', () => {
    const r = computeSidebar(['a', 'b', 'c', 'd'], 'c', WIDE);
    const m = byId(r);
    const colW = Math.round(WIDE.width * SIDEBAR_FRACTION);
    expect(m.get('c')).toEqual({ id: 'c', x: 0, y: 0, width: WIDE.width - colW, height: WIDE.height });
    expect([m.get('a')?.y, m.get('b')?.y, m.get('d')?.y]).toEqual([0, 300, 600]);
    for (const id of ['a', 'b', 'd']) expect(m.get(id)).toMatchObject({ x: WIDE.width - colW, width: colW, height: 300 });
    expectInside(r, WIDE);
  });

  it('stays vertical even in a tall window', () => {
    const r = computeSidebar(['a', 'b'], 'a', TALL);
    const m = byId(r);
    expect(m.get('b')?.x).toBe(TALL.width - Math.round(TALL.width * SIDEBAR_FRACTION));
    expect(m.get('b')?.height).toBe(TALL.height);
  });
});
