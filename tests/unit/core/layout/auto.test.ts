import { describe, expect, it } from 'vitest';
import { computeAuto } from '../../../../src/core/layout/auto';
import { minPanelSize } from '../../../../src/core/layout/types';

const min = minPanelSize({ width: 8, height: 17 }, { width: 2, height: 30 }); // 322 × 200
const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i}`);

describe('computeAuto', () => {
  it('derives the minimum from 40 columns by 10 rows', () => {
    expect(min).toEqual({ width: 322, height: 200 });
  });

  it('fills the area with one panel', () => {
    const r = computeAuto(ids(1), { width: 1600, height: 900 }, min);
    expect(r.rects).toEqual([{ id: 'e0', x: 0, y: 0, width: 1600, height: 900 }]);
    expect(r.overflow).toBe(false);
  });

  it('places 1 to 12 panels without any panel below the minimum on a large screen', () => {
    for (let n = 1; n <= 12; n++) {
      const r = computeAuto(ids(n), { width: 2400, height: 1300 }, min);
      expect(r.rects).toHaveLength(n);
      expect(r.overflow).toBe(false);
      for (const rect of r.rects) {
        expect(rect.width).toBeGreaterThanOrEqual(min.width - 1);
        expect(rect.height).toBeGreaterThanOrEqual(min.height - 1);
      }
      const area = r.rects.reduce((a, x) => a + x.width * x.height, 0);
      expect(area).toBeGreaterThan(2400 * 1300 * 0.98);
    }
  });

  it('uses 3×2 for six panels on a wide screen', () => {
    const r = computeAuto(ids(6), { width: 1920, height: 1000 }, min);
    expect(new Set(r.rects.map((x) => x.y)).size).toBe(2);
    expect(new Set(r.rects.map((x) => x.x)).size).toBe(3);
  });

  it('stretches the incomplete last row to the full width', () => {
    const r = computeAuto(ids(5), { width: 1500, height: 900 }, min);
    const lastRowY = Math.max(...r.rects.map((x) => x.y));
    const lastRow = r.rects.filter((x) => x.y === lastRowY);
    expect(lastRow.reduce((a, x) => a + x.width, 0)).toBe(1500);
  });

  it('scrolls instead of shrinking below the minimum', () => {
    const r = computeAuto(ids(12), { width: 1000, height: 600 }, min);
    expect(r.overflow).toBe(true);
    expect(r.contentHeight).toBeGreaterThan(600);
    for (const rect of r.rects) {
      expect(rect.width).toBeGreaterThanOrEqual(min.width - 1);
      expect(rect.height).toBeGreaterThanOrEqual(min.height);
    }
    // nada se sobrepõe
    for (const a of r.rects)
      for (const b of r.rects)
        if (a !== b)
          expect(
            a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y,
          ).toBe(true);
  });

  it('handles an empty grid', () => {
    expect(computeAuto([], { width: 100, height: 100 }, min)).toEqual({
      rects: [],
      contentHeight: 0,
      overflow: false,
    });
  });
});
