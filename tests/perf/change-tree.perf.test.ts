import { describe, expect, it } from 'vitest';
import {
  buildChangeTree,
  checkStates,
  initialSelection,
  toggle,
  type RepoView,
  type Selection,
} from '../../src/renderer/git/git-store';
import type { Change, RepoStatus } from '../../src/shared/ipc-contract';

const BUDGET_MS = 200;

function repo(name: string, count: number): RepoView {
  const changes: Change[] = Array.from({ length: count }, (_, i) => ({
    path: `pkg${i % 20}/sub${i % 7}/file${i}.ts`,
    kind: 'modified',
    indexChanged: false,
    worktreeChanged: true,
  }));
  const status: RepoStatus = {
    root: `/w/${name}`,
    branch: 'main',
    head: 'a'.repeat(40),
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    state: 'normal',
    mergeMessage: null,
    changes,
    hasRemote: true,
    defaultRemoteBranch: 'main',
    lastFetchAt: null,
  };
  return { folderId: name, root: status.root, name, status };
}

describe('change tree performance', () => {
  it('builds a tree of 3 repos with 500 files and toggles the group under 200 ms', () => {
    const repos = [repo('a', 170), repo('b', 170), repo('c', 160)];
    const selection: Selection = new Map(repos.map((r) => [r.root, initialSelection(r.status)] as const));

    const started = performance.now();
    const tree = buildChangeTree(repos);
    const group = tree[0];
    if (!group) throw new Error('árvore vazia');
    const off = toggle(group, selection);
    const offStates = checkStates(tree, off);
    const on = toggle(group, off);
    const onStates = checkStates(tree, on);
    const elapsed = performance.now() - started;

    expect(group.count).toBe(500);
    expect(offStates.get(group.id)).toBe('unchecked');
    expect(onStates.get(group.id)).toBe('checked');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
