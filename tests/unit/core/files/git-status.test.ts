import { describe, expect, it } from 'vitest';
import { parseStatusZ, toStatusMap } from '../../../../src/core/files/git-status';

const z = (...parts: string[]) => `${parts.join('\0')}\0`;

describe('parseStatusZ', () => {
  it('maps the two status letters to a single change', () => {
    const entries = parseStatusZ(
      z(' M src/a.ts', 'A  src/b.ts', 'D  src/c.ts', '?? novo.txt', 'M  src/d.ts'),
    );
    expect(entries).toEqual([
      { path: 'src/a.ts', change: 'modified' },
      { path: 'src/b.ts', change: 'added' },
      { path: 'src/c.ts', change: 'deleted' },
      { path: 'novo.txt', change: 'untracked' },
      { path: 'src/d.ts', change: 'modified' },
    ]);
  });

  it('consumes the origin path of a rename instead of treating it as an entry', () => {
    const entries = parseStatusZ(z('R  novo.txt', 'velho.txt', ' M outro.txt'));
    expect(entries).toEqual([
      { path: 'novo.txt', change: 'renamed' },
      { path: 'outro.txt', change: 'modified' },
    ]);
  });

  it('ignores empty records', () => {
    expect(parseStatusZ('\0\0')).toEqual([]);
  });
});

describe('toStatusMap', () => {
  it('keeps the most severe change when a path repeats', () => {
    const map = toStatusMap([
      { path: 'a.ts', change: 'modified' },
      { path: 'a.ts', change: 'deleted' },
    ]);
    expect(map).toEqual({ 'a.ts': 'deleted' });
  });
});
