import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeProcessRunner } from '../../../../src/adapters/node-process-runner';
import { baseAdvancedBy } from '../../../../src/core/git/divergence';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import {
  expectMainTreeUnchanged,
  snapshotMainTree,
  type MainTreeSnapshot,
} from '../../../support/main-tree-invariant';

let repo: TempRepo;
let log: MemoryLogger;
let runner: GitRunner;

beforeEach(() => {
  repo = createTempRepo({ branches: ['dev'] });
  log = new MemoryLogger();
  runner = new GitRunner(new NodeProcessRunner(), log);
});

afterEach(() => repo.cleanup());

/** Avança `refs/heads/<branch>` com commits criados por commit-tree, sem tocar a árvore de trabalho. */
function advance(branch: string, n: number): void {
  for (let i = 0; i < n; i += 1) {
    const parent = git(repo.root, ['rev-parse', `refs/heads/${branch}`]).trim();
    const tree = git(repo.root, ['rev-parse', `${parent}^{tree}`]).trim();
    const sha = git(repo.root, ['commit-tree', tree, '-p', parent, '-m', `avanço ${i}`]).trim();
    git(repo.root, ['update-ref', `refs/heads/${branch}`, sha]);
  }
}

describe('baseAdvancedBy', () => {
  it('counts the commits the base advanced since the worktree was created', async () => {
    const base = repo.head();
    let snap: MainTreeSnapshot = snapshotMainTree(repo.root);
    expect(await baseAdvancedBy({ git: runner, log }, { repoRoot: repo.root, baseRef: 'dev', baseCommit: base })).toBe(0);
    expectMainTreeUnchanged(repo.root, snap);
    advance('dev', 3);
    snap = snapshotMainTree(repo.root);
    expect(await baseAdvancedBy({ git: runner, log }, { repoRoot: repo.root, baseRef: 'dev', baseCommit: base })).toBe(3);
    expectMainTreeUnchanged(repo.root, snap);
  });

  it('returns 0 and logs a warning when the base no longer exists', async () => {
    const base = repo.head();
    git(repo.root, ['branch', '-D', 'dev']);
    expect(await baseAdvancedBy({ git: runner, log }, { repoRoot: repo.root, baseRef: 'dev', baseCommit: base })).toBe(0);
    expect(log.records.some((e) => e.event === 'divergence.base_missing' && e.level === 'warn')).toBe(true);
  });

  it('a commit used as base never advances', async () => {
    const base = repo.head();
    advance('main', 2);
    expect(await baseAdvancedBy({ git: runner, log }, { repoRoot: repo.root, baseRef: base, baseCommit: base })).toBe(0);
  });
});
