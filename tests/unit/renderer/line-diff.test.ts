import { describe, expect, it } from 'vitest';
import {
  diffLines,
  LINE_DIFF_MAX_CHANGED,
  splitLines,
} from '../../../src/renderer/components/Editor/line-diff';

const lines = (...l: string[]) => l.join('\n');
const BASE = lines('um', 'dois', 'tres', 'quatro', 'cinco');

describe('diffLines', () => {
  it('marks nothing for equal texts', () => {
    expect(diffLines(BASE, BASE)).toEqual([]);
  });

  it('does not mark a change of line endings alone (CRLF × LF)', () => {
    expect(diffLines(BASE.replace(/\n/g, '\r\n'), BASE)).toEqual([]);
    expect(diffLines(BASE, `${BASE.replace(/\n/g, '\r\n')}`)).toEqual([]);
  });

  it('marks added lines at the start, in the middle and at the end', () => {
    expect(diffLines(BASE, lines('zero', 'um', 'dois', 'tres', 'quatro', 'cinco'))).toEqual([
      { fromLine: 1, toLine: 1, kind: 'added', original: '' },
    ]);
    expect(diffLines(BASE, lines('um', 'dois', 'a', 'b', 'tres', 'quatro', 'cinco'))).toEqual([
      { fromLine: 3, toLine: 4, kind: 'added', original: '' },
    ]);
    expect(diffLines(BASE, lines('um', 'dois', 'tres', 'quatro', 'cinco', 'seis'))).toEqual([
      { fromLine: 6, toLine: 6, kind: 'added', original: '' },
    ]);
  });

  it('marks modified lines with the original text', () => {
    expect(diffLines(BASE, lines('UM', 'dois', 'tres', 'QUATRO', 'CINCO'))).toEqual([
      { fromLine: 1, toLine: 1, kind: 'modified', original: 'um' },
      { fromLine: 4, toLine: 5, kind: 'modified', original: 'quatro\ncinco' },
    ]);
  });

  it('marks removed lines at the start, in the middle and at the end, on the next line', () => {
    expect(diffLines(BASE, lines('dois', 'tres', 'quatro', 'cinco'))).toEqual([
      { fromLine: 1, toLine: 1, kind: 'removed', original: 'um' },
    ]);
    expect(diffLines(BASE, lines('um', 'quatro', 'cinco'))).toEqual([
      { fromLine: 2, toLine: 2, kind: 'removed', original: 'dois\ntres' },
    ]);
    expect(diffLines(BASE, lines('um', 'dois', 'tres', 'quatro'))).toEqual([
      { fromLine: 4, toLine: 4, kind: 'removed', original: 'cinco', atEnd: true },
    ]);
  });

  it('mixes the three kinds in one text', () => {
    const current = lines('um', 'DOIS', 'tres', 'novo', 'cinco');
    expect(diffLines(BASE, current)).toEqual([
      { fromLine: 2, toLine: 2, kind: 'modified', original: 'dois' },
      { fromLine: 4, toLine: 4, kind: 'modified', original: 'quatro' },
    ]);
    expect(diffLines(lines('a', 'b', 'c', 'd'), lines('a', 'x', 'c', 'y', 'z'))).toEqual([
      { fromLine: 2, toLine: 2, kind: 'modified', original: 'b' },
      { fromLine: 4, toLine: 5, kind: 'modified', original: 'd' },
    ]);
  });

  it('keeps repeated lines aligned (the minimal diff)', () => {
    const base = lines('x', 'a', 'x', 'b', 'x');
    expect(diffLines(base, lines('x', 'a', 'x', 'novo', 'x', 'b', 'x'))).toEqual([
      { fromLine: 4, toLine: 5, kind: 'added', original: '' },
    ]);
  });

  it('handles an empty side', () => {
    expect(diffLines('', lines('a', 'b'))).toEqual([
      { fromLine: 1, toLine: 2, kind: 'modified', original: '' },
    ]);
    expect(diffLines(lines('a', 'b'), '')).toEqual([
      { fromLine: 1, toLine: 1, kind: 'modified', original: 'a\nb' },
    ]);
  });

  it('turns itself off above 5,000 changed lines', () => {
    const base = Array.from({ length: 3000 }, (_, i) => `base ${i}`).join('\n');
    const current = Array.from({ length: 3000 }, (_, i) => `novo ${i}`).join('\n');
    expect(diffLines(base, current)).toBe('off');
    const few = Array.from({ length: LINE_DIFF_MAX_CHANGED / 2 }, (_, i) => `base ${i}`).join('\n');
    expect(diffLines(few, `${few}\nmais`)).not.toBe('off');
  });

  it('matches a brute force LCS on random edits', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let round = 0; round < 40; round++) {
      const base = Array.from({ length: 30 }, () => `l${rand(6)}`);
      const current = base.filter(() => rand(4) !== 0).map((l) => (rand(5) === 0 ? `${l}x` : l));
      for (let k = 0; k < 3; k++) current.splice(rand(current.length + 1), 0, `n${rand(3)}`);
      const result = diffLines(base.join('\n'), current.join('\n'));
      expect(result).not.toBe('off');
      const kept = (result as Exclude<typeof result, 'off'>).reduce(
        (acc, c) => acc - (c.kind === 'removed' ? 0 : c.toLine - c.fromLine + 1),
        current.length,
      );
      expect(kept).toBe(lcs(base, current));
    }
  });
});

function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  return dp[a.length]![b.length]!;
}

describe('splitLines', () => {
  it('splits at CRLF, LF and CR', () => {
    expect(splitLines('a\r\nb\nc\rd')).toEqual(['a', 'b', 'c', 'd']);
  });
});
