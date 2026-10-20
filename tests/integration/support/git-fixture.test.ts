import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTempRepo, git, type TempRepo } from '../../support/git-fixture';
import { expectMainTreeUnchanged, snapshotMainTree } from '../../support/main-tree-invariant';

let repo: TempRepo | undefined;
afterEach(() => repo?.cleanup());

describe('createTempRepo', () => {
  it('creates commits, branches, binaries and generated files', () => {
    repo = createTempRepo({
      files: { 'bin.dat': new Uint8Array([0, 255, 1]) },
      generatedFiles: 5,
      branches: ['dev'],
    });
    expect(git(repo.root, ['ls-files']).trim().split('\n')).toHaveLength(7);
    expect(git(repo.root, ['branch', '--list', 'dev']).trim()).toBe('dev');
    const before = repo.head();
    const after = repo.commit({ 'x.txt': 'x' });
    expect(after).not.toBe(before);
  });
});

describe('main tree invariant', () => {
  it('passes when nothing changed and fails on any change', () => {
    repo = createTempRepo();
    const snap = snapshotMainTree(repo.root);
    expectMainTreeUnchanged(repo.root, snap);
    writeFileSync(join(repo.root, 'README.md'), 'mudou');
    expect(() => expectMainTreeUnchanged(repo!.root, snap)).toThrow();
  });

  it('detects index changes and branch switches', () => {
    repo = createTempRepo({ branches: ['dev'] });
    const snap = snapshotMainTree(repo.root);
    git(repo.root, ['checkout', '-q', 'dev']);
    expect(() => expectMainTreeUnchanged(repo!.root, snap)).toThrow();
    git(repo.root, ['checkout', '-q', 'main']);
    writeFileSync(join(repo.root, 'n.txt'), 'n');
    git(repo.root, ['add', 'n.txt']);
    const snap2 = snapshotMainTree(repo.root);
    git(repo.root, ['reset', '-q']);
    expect(snapshotMainTree(repo.root).indexHash).not.toBe(snap2.indexHash);
  });
});
