import { describe, expect, it } from 'vitest';
import { parseStatusV2 } from '../../../../src/core/git/status-v2';

const Z = '\0';
const OID = 'a'.repeat(40);

function out(...entries: string[]): string {
  return entries.join(Z) + Z;
}

describe('parseStatusV2', () => {
  it('reads branch headers with upstream and ahead/behind', () => {
    const r = parseStatusV2(
      out(`# branch.oid ${OID}`, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -3'),
    );
    expect(r).toMatchObject({ head: OID, branch: 'main', upstream: 'origin/main', ahead: 2, behind: 3, changes: [] });
  });

  it('gives null ahead/behind and upstream when there is no upstream', () => {
    const r = parseStatusV2(out(`# branch.oid ${OID}`, '# branch.head feature'));
    expect(r).toMatchObject({ branch: 'feature', upstream: null, ahead: null, behind: null });
  });

  it('reports a detached head as null branch', () => {
    const r = parseStatusV2(out(`# branch.oid ${OID}`, '# branch.head (detached)'));
    expect(r.branch).toBeNull();
  });

  it('keeps an empty head for a repository without commits', () => {
    const r = parseStatusV2(out('# branch.oid (initial)', '# branch.head main'));
    expect(r.head).toBe('');
    expect(r.branch).toBe('main');
  });

  it('parses a modified entry with index and worktree flags', () => {
    const r = parseStatusV2(
      out(
        `1 .M N... 100644 100644 100644 ${OID} ${OID} src/a.ts`,
        `1 M. N... 100644 100644 100644 ${OID} ${OID} src/b.ts`,
        `1 MM N... 100644 100644 100644 ${OID} ${OID} src/c.ts`,
      ),
    );
    expect(r.changes).toEqual([
      { path: 'src/a.ts', kind: 'modified', indexChanged: false, worktreeChanged: true },
      { path: 'src/b.ts', kind: 'modified', indexChanged: true, worktreeChanged: false },
      { path: 'src/c.ts', kind: 'modified', indexChanged: true, worktreeChanged: true },
    ]);
  });

  it('maps added and deleted entries', () => {
    const r = parseStatusV2(
      out(
        `1 A. N... 000000 100644 100644 ${OID} ${OID} novo.txt`,
        `1 .D N... 100644 100644 000000 ${OID} ${OID} velho.txt`,
        `1 D. N... 100644 000000 000000 ${OID} ${OID} velho2.txt`,
      ),
    );
    expect(r.changes.map((c) => [c.path, c.kind])).toEqual([
      ['novo.txt', 'added'],
      ['velho.txt', 'deleted'],
      ['velho2.txt', 'deleted'],
    ]);
  });

  it('parses a renamed entry with its original path', () => {
    const r = parseStatusV2(
      `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 novo/nome.ts${Z}antigo/nome.ts${Z}`,
    );
    expect(r.changes).toEqual([
      { path: 'novo/nome.ts', oldPath: 'antigo/nome.ts', kind: 'renamed', indexChanged: true, worktreeChanged: false },
    ]);
  });

  it('parses an unmerged entry as conflict', () => {
    const r = parseStatusV2(out(`u UU N... 100644 100644 100644 100644 ${OID} ${OID} ${OID} conflito.txt`));
    expect(r.changes).toEqual([
      { path: 'conflito.txt', kind: 'conflict', indexChanged: true, worktreeChanged: true },
    ]);
  });

  it('lists untracked files inside a new folder, not the folder', () => {
    const r = parseStatusV2(out('? pasta-nova/a.txt', '? pasta-nova/sub/b.txt'));
    expect(r.changes.map((c) => c.path)).toEqual(['pasta-nova/a.txt', 'pasta-nova/sub/b.txt']);
    expect(r.changes.every((c) => c.kind === 'untracked' && c.worktreeChanged && !c.indexChanged)).toBe(true);
  });

  it('ignores ignored entries and keeps spaces and accents in paths', () => {
    const r = parseStatusV2(
      out(
        '! build/out.js',
        `1 .M N... 100644 100644 100644 ${OID} ${OID} pasta com espaço/ação final.txt`,
        '? relatório 2026.md',
      ),
    );
    expect(r.changes.map((c) => c.path)).toEqual(['pasta com espaço/ação final.txt', 'relatório 2026.md']);
  });

  it('returns empty data for empty output', () => {
    expect(parseStatusV2('')).toMatchObject({ branch: null, upstream: null, changes: [] });
  });
});
