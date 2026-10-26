import { describe, expect, it } from 'vitest';
import { diffLines } from '../../src/renderer/components/Editor/line-diff';

function median(fn: () => void): number {
  fn();
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[2] ?? Infinity;
}

const base = Array.from({ length: 10_000 }, (_, i) => `const linha${i} = ${i % 97};`);

describe('line diff performance', () => {
  it('diffs a file with 5,000 changed lines in under 500 ms', () => {
    const current = base.map((line, i) => (i % 4 === 0 ? `${line} // mudou` : line));
    const ms = median(() => {
      const r = diffLines(base.join('\n'), current.join('\n'));
      expect(r).not.toBe('off');
    });
    expect(ms).toBeLessThan(500);
  });

  it('recomputes after a single keystroke in a 10,000-line file in under 100 ms', () => {
    const before = base.join('\n');
    const typed = [...base];
    typed[5_000] = `${typed[5_000]}x`;
    const ms = median(() => {
      const r = diffLines(before, typed.join('\n'));
      expect(r).toHaveLength(1);
    });
    expect(ms).toBeLessThan(100);
  });
});
