import { describe, expect, it } from 'vitest';
import {
  buildChangeTree,
  checkState,
  checkStates,
  initialSelection,
  mergeSelection,
  planCommit,
  pruneAdded,
  addPaths,
  toggle,
  visibleRows,
  type RepoView,
  type Selection,
  type TreeNode,
} from '../../../../src/renderer/git/git-store';
import type { Change } from '../../../../src/shared/ipc-contract';
import { repoStatus } from '../../../support/fake-api';

const change = (path: string, kind: Change['kind'] = 'modified', extra: Partial<Change> = {}): Change => ({
  path,
  kind,
  indexChanged: false,
  worktreeChanged: true,
  ...extra,
});

function repo(name: string, changes: Change[], over: Partial<RepoView['status']> = {}): RepoView {
  return {
    folderId: `f-${name}`,
    root: `/w/${name}`,
    name,
    status: repoStatus({ root: `/w/${name}`, changes, ...over }),
  };
}

const find = (nodes: TreeNode[], id: string): TreeNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n;
    const inner = find(n.children, id);
    if (inner) return inner;
  }
  return undefined;
};

const files = (n: TreeNode): string[] =>
  n.kind === 'file' ? [n.path as string] : n.children.flatMap((c) => files(c));

describe('buildChangeTree', () => {
  const a = repo(
    'a',
    [change('src/x.ts'), change('src/deep/y.ts', 'added'), change('README.md'), change('notes.txt', 'untracked')],
    { branch: 'main' },
  );
  const b = repo('b', [change('z.ts', 'deleted')], { branch: 'dev' });

  it('splits Changes and Unversioned Files with a node per repo', () => {
    const tree = buildChangeTree([a, b]);
    expect(tree.map((g) => [g.label, g.count])).toEqual([
      ['Changes', 4],
      ['Unversioned Files', 1],
    ]);
    const changes = tree[0] as TreeNode;
    expect(changes.children.map((r) => [r.label, r.count, r.branch])).toEqual([
      ['a', 3, 'main'],
      ['b', 1, 'dev'],
    ]);
    expect(files(tree[1] as TreeNode)).toEqual(['notes.txt']);
    expect((tree[1] as TreeNode).children[0]?.label).toBe('a');
  });

  it('nests folders, folders before files', () => {
    const tree = buildChangeTree([a]);
    const repoNode = tree[0]?.children[0] as TreeNode;
    expect(repoNode.children.map((n) => [n.kind, n.label])).toEqual([
      ['dir', 'src'],
      ['file', 'README.md'],
    ]);
    const src = repoNode.children[0] as TreeNode;
    expect(src.children.map((n) => n.label)).toEqual(['deep', 'x.ts']);
    expect(src.count).toBe(2);
  });

  it('shows a renamed file at its new path', () => {
    const tree = buildChangeTree([repo('a', [change('new/n.ts', 'renamed', { oldPath: 'old/n.ts' })])]);
    expect(files(tree[0] as TreeNode)).toEqual(['new/n.ts']);
  });

  it('lists a repo without changes only when there is more than one repo', () => {
    const empty = repo('e', []);
    expect(buildChangeTree([empty])).toEqual([]);
    const tree = buildChangeTree([empty, b]);
    expect(tree[0]?.children.map((r) => [r.label, r.count])).toEqual([
      ['e', 0],
      ['b', 1],
    ]);
  });

  it('puts unversioned files straight under the group with a single repo', () => {
    const tree = buildChangeTree([repo('a', [change('n.txt', 'untracked')])]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.label).toBe('Unversioned Files');
    expect(tree[0]?.children[0]?.kind).toBe('file');
  });
});

describe('selection', () => {
  const a = repo('a', [change('src/x.ts'), change('src/y.ts'), change('n.txt', 'untracked')]);
  const b = repo('b', [change('z.ts')]);
  const repos = [a, b];
  const selectionOf = (): Selection => new Map(repos.map((r) => [r.root, initialSelection(r.status)] as const));

  it('initialSelection marks changed files and leaves untracked ones out', () => {
    expect([...initialSelection(a.status)].sort()).toEqual(['src/x.ts', 'src/y.ts']);
  });

  it('initialSelection marks everything while merging', () => {
    const m = repo('m', [change('u.txt', 'untracked'), change('v.ts', 'conflict')], { state: 'merging' });
    expect([...initialSelection(m.status)].sort()).toEqual(['u.txt', 'v.ts']);
  });

  it('checkState is partial in folder, repo and group', () => {
    const tree = buildChangeTree(repos);
    const sel = selectionOf();
    const partial = new Map(sel);
    partial.set(a.root, new Set(['src/x.ts']));
    const src = find(tree, `dir:changes:${a.root}:src`) as TreeNode;
    const repoA = find(tree, `repo:changes:${a.root}`) as TreeNode;
    expect(checkState(src, partial)).toBe('partial');
    expect(checkState(repoA, partial)).toBe('partial');
    expect(checkState(tree[0] as TreeNode, partial)).toBe('partial');
    expect(checkState(repoA, sel)).toBe('checked');
    expect(checkState(tree[1] as TreeNode, sel)).toBe('unchecked');
    expect(checkStates(tree, partial).get(src.id)).toBe('partial');
  });

  it('toggle checks, unchecks and completes a partial node at every level', () => {
    const tree = buildChangeTree(repos);
    const src = find(tree, `dir:changes:${a.root}:src`) as TreeNode;
    const off = toggle(src, selectionOf());
    expect(off.get(a.root)?.size).toBe(0);
    expect(checkState(src, off)).toBe('unchecked');
    const partial = toggle(find(tree, `file:${a.root}:src/x.ts`) as TreeNode, selectionOf());
    expect(checkState(src, partial)).toBe('partial');
    expect(checkState(src, toggle(src, partial))).toBe('checked');
    const group = toggle(tree[0] as TreeNode, selectionOf());
    expect([...group.values()].every((s) => s.size === 0)).toBe(true);
    const untracked = toggle(tree[1] as TreeNode, selectionOf());
    expect(untracked.get(a.root)?.has('n.txt')).toBe(true);
    expect(toggle(tree[0] as TreeNode, group).get(b.root)?.has('z.ts')).toBe(true);
  });

  it('toggle does not mutate the previous selection', () => {
    const tree = buildChangeTree(repos);
    const sel = selectionOf();
    toggle(tree[0] as TreeNode, sel);
    expect(sel.get(a.root)?.size).toBe(2);
  });

  it('mergeSelection keeps marks that remain and applies the initial rule to new paths', () => {
    const before = repoStatus({ changes: [change('a.ts'), change('b.ts'), change('c.ts', 'untracked')] });
    const prev = new Set(['a.ts']);
    const after = repoStatus({
      changes: [change('a.ts'), change('b.ts'), change('c.ts', 'untracked'), change('d.ts'), change('e.txt', 'untracked')],
    });
    expect([...mergeSelection(prev, before, after)].sort()).toEqual(['a.ts', 'd.ts']);
    const gone = repoStatus({ changes: [change('b.ts')] });
    expect([...mergeSelection(prev, before, gone)]).toEqual([]);
    expect([...mergeSelection(undefined, undefined, after)].sort()).toEqual(['a.ts', 'b.ts', 'd.ts']);
  });
});

describe('planCommit', () => {
  it('plans only repos with marked files', () => {
    const a = repo('a', [change('x.ts'), change('y.ts')]);
    const b = repo('b', [change('z.ts')]);
    const sel: Selection = new Map([
      [a.root, new Set(['y.ts'])],
      [b.root, new Set<string>()],
    ]);
    const r = planCommit([a, b], sel);
    expect(r.error).toBeNull();
    expect(r.plan.map((p) => [p.repo.name, p.paths])).toEqual([['a', ['y.ts']]]);
  });

  it('refuses a merging repo with a partial selection, with the 006 message', () => {
    const m = repo('m', [change('p.ts'), change('q.ts')], { state: 'merging' });
    const r = planCommit([m], new Map([[m.root, new Set(['p.ts'])]]));
    expect(r.plan).toEqual([]);
    expect(r.error).toBe('m: Durante um merge, todos os arquivos entram no commit.');
  });

  it('accepts a merging repo with every file marked', () => {
    const m = repo('m', [change('p.ts'), change('q.ts')], { state: 'merging' });
    const r = planCommit([m], new Map([[m.root, new Set(['p.ts', 'q.ts'])]]));
    expect(r.error).toBeNull();
    expect(r.plan[0]?.paths).toEqual(['p.ts', 'q.ts']);
  });

  it('refuses a repo that still has conflicts', () => {
    const m = repo('m', [change('p.ts', 'conflict')], { state: 'merging' });
    const r = planCommit([m], new Map([[m.root, new Set(['p.ts'])]]));
    expect(r.error).toBe('m: Resolva os conflitos antes de concluir o merge.');
  });
});

describe('visibleRows', () => {
  it('lists only nodes under expanded parents, with depth', () => {
    const a = repo('a', [change('src/x.ts'), change('r.md')]);
    const tree = buildChangeTree([a]);
    expect(visibleRows(tree, new Set()).map((r) => r.node.label)).toEqual(['Changes']);
    const open = new Set(['group:changes', `repo:changes:${a.root}`]);
    expect(visibleRows(tree, open).map((r) => [r.node.label, r.depth])).toEqual([
      ['Changes', 0],
      ['a', 1],
      ['src', 2],
      ['r.md', 2],
    ]);
  });
});

describe('Adicionar ao git (só na interface)', () => {
  const a = repo('a', [change('x.ts'), change('docs/n.md', 'untracked'), change('o.txt', 'untracked')]);

  it('moves the added unversioned files to Changes, still as new files', () => {
    const tree = buildChangeTree([a], new Map([[a.root, new Set(['docs/n.md'])]]));
    expect(files(tree[0] as TreeNode).sort()).toEqual(['docs/n.md', 'x.ts']);
    expect(files(tree[1] as TreeNode)).toEqual(['o.txt']);
    expect(find(tree, `file:${a.root}:docs/n.md`)?.change?.kind).toBe('untracked');
  });

  it('drops the Unversioned group when every new file was added', () => {
    const tree = buildChangeTree([a], new Map([[a.root, new Set(['docs/n.md', 'o.txt'])]]));
    expect(tree.map((g) => g.label)).toEqual(['Changes']);
    expect(tree[0]?.count).toBe(3);
  });

  it('pruneAdded keeps only paths that are still unversioned', () => {
    const later = repo('a', [change('docs/n.md', 'added'), change('o.txt', 'untracked')]);
    const pruned = pruneAdded(new Map([[a.root, new Set(['docs/n.md', 'o.txt', 'sumiu.txt'])]]), [later]);
    expect([...(pruned.get(a.root) ?? [])]).toEqual(['o.txt']);
    expect(pruneAdded(new Map([[a.root, new Set(['docs/n.md'])]]), [later]).has(a.root)).toBe(false);
  });

  it('addPaths joins files per repo without touching the previous selection', () => {
    const prev = new Map([[a.root, new Set(['x.ts'])]]);
    const next = addPaths(prev, [
      { root: a.root, path: 'o.txt' },
      { root: '/w/b', path: 'z.ts' },
    ]);
    expect([...(next.get(a.root) ?? [])].sort()).toEqual(['o.txt', 'x.ts']);
    expect([...(next.get('/w/b') ?? [])]).toEqual(['z.ts']);
    expect(prev.get(a.root)?.size).toBe(1);
  });
});
