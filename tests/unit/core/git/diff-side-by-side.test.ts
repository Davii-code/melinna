import { describe, expect, it } from 'vitest';
import type { Hunk } from '../../../../src/core/api-types';
import { toSideBySide } from '../../../../src/core/git/diff-side-by-side';

const c = (text: string, oldNo: number, newNo: number) => ({ kind: 'context' as const, text, oldNo, newNo });
const d = (text: string, oldNo: number) => ({ kind: 'del' as const, text, oldNo, newNo: null });
const a = (text: string, newNo: number) => ({ kind: 'add' as const, text, oldNo: null, newNo });

function hunk(lines: Hunk['lines']): Hunk {
  return { header: '@@', oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, lines };
}

describe('toSideBySide', () => {
  it('puts context on both sides and pairs removals with the additions that follow', () => {
    const rows = toSideBySide(hunk([c('x', 1, 1), d('a', 2), d('b', 3), a('A', 2), c('y', 4, 3)]));
    expect(rows).toEqual([
      { left: c('x', 1, 1), right: c('x', 1, 1) },
      { left: d('a', 2), right: a('A', 2) },
      { left: d('b', 3), right: null },
      { left: c('y', 4, 3), right: c('y', 4, 3) },
    ]);
  });

  it('leaves the left side empty for pure additions and keeps extra additions', () => {
    const rows = toSideBySide(hunk([a('1', 1), d('z', 1), a('2', 2), a('3', 3)]));
    expect(rows).toEqual([
      { left: null, right: a('1', 1) },
      { left: d('z', 1), right: a('2', 2) },
      { left: null, right: a('3', 3) },
    ]);
  });

  it('returns no rows for an empty hunk', () => {
    expect(toSideBySide(hunk([]))).toEqual([]);
  });
});
