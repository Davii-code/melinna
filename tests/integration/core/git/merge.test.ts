import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let repo: TempRepo;
let root: string;
let rig: GitServiceRig;

beforeEach(() => {
  repo = createTempRepo({ files: { 'a.txt': 'linha 1\nlinha 2\nlinha 3\n', 'b.txt': 'b\n' } });
  root = repo.root;
  rig = makeGitService();
});

afterEach(() => {
  repo.cleanup();
  rig.cleanup();
});

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

function write(file: string, content: string): void {
  writeFileSync(join(root, file), content);
}

function commitAll(message: string): void {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

/** `feature` e `main` divergem: feature cria `f.txt`, main muda `b.txt`. */
function diverge(): void {
  git(root, ['checkout', '-q', '-b', 'feature']);
  write('f.txt', 'da feature\n');
  commitAll('feature');
  git(root, ['checkout', '-q', 'main']);
  write('b.txt', 'b na main\n');
  commitAll('main');
}

/** `feature` e `main` mudam a mesma linha de `a.txt`. */
function conflict(): void {
  git(root, ['checkout', '-q', '-b', 'feature']);
  write('a.txt', 'linha 1\nda feature\nlinha 3\n');
  commitAll('feature muda a');
  git(root, ['checkout', '-q', 'main']);
  write('a.txt', 'linha 1\nda main\nlinha 3\n');
  commitAll('main muda a');
}

describe('GitService.merge', () => {
  it('merges without conflicts', async () => {
    diverge();
    expect(await rig.service.merge(root, 'feature')).toEqual({ conflicts: [] });
    expect(existsSync(join(root, 'f.txt'))).toBe(true);
    expect(git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')).toHaveLength(3);
    expect((await rig.service.status(root)).state).toBe('normal');
  });

  it('refuses a branch that does not exist', async () => {
    expect((await failure(rig.service.merge(root, 'nao-existe'))).code).toBe('INPUT_INVALID');
  });

  it('asks for confirmation when the tree is dirty and does nothing before it', async () => {
    diverge();
    write('b.txt', 'sujo\n');
    const before = git(root, ['rev-parse', 'HEAD']).trim();
    const needs = await rig.service.merge(root, 'feature');
    expect(needs).toEqual({
      needsConfirm: 'merge-dirty',
      details: { files: [{ path: 'b.txt' }], branch: 'feature' },
    });
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(before);
    expect((await rig.service.status(root)).state).toBe('normal');
  });

  it('reports conflicts, leaves the merge open and exposes the merge message', async () => {
    conflict();
    const result = await rig.service.merge(root, 'feature');
    expect(result).toEqual({ conflicts: ['a.txt'] });
    const status = await rig.service.status(root);
    expect(status.state).toBe('merging');
    expect(status.changes).toMatchObject([{ path: 'a.txt', kind: 'conflict' }]);
    expect(status.mergeMessage).toMatch(/^Merge branch 'feature'/);
    expect(status.mergeMessage).not.toContain('#');
  });

  it('marks a file resolved and commits every file to conclude the merge', async () => {
    conflict();
    await rig.service.merge(root, 'feature');
    const unresolved = await failure(
      rig.service.commit(root, { paths: ['a.txt'], message: 'x', amend: false }),
    );
    expect(unresolved.code).toBe('INPUT_INVALID');
    write('a.txt', 'linha 1\nresolvido\nlinha 3\n');
    await rig.service.markResolved(root, ['a.txt']);
    const status = await rig.service.status(root);
    expect(status.changes.every((c) => c.kind !== 'conflict')).toBe(true);
    const partial = await failure(rig.service.commit(root, { paths: [], message: 'x', amend: true }));
    expect(partial.code).toBe('INPUT_INVALID');
    await rig.service.commit(root, {
      paths: status.changes.map((c) => c.path),
      message: status.mergeMessage ?? 'merge',
      amend: false,
    });
    expect(git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')).toHaveLength(3);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('linha 1\nresolvido\nlinha 3\n');
    expect((await rig.service.status(root)).state).toBe('normal');
  });

  it('rejects marking a file that has no changes', async () => {
    conflict();
    await rig.service.merge(root, 'feature');
    expect((await failure(rig.service.markResolved(root, ['b.txt']))).code).toBe('INPUT_INVALID');
    expect((await failure(rig.service.markResolved(root, []))).code).toBe('INPUT_INVALID');
  });
});

describe('GitService.abortMerge', () => {
  it('asks for confirmation and then restores the state before the merge', async () => {
    conflict();
    const before = git(root, ['rev-parse', 'HEAD']).trim();
    await rig.service.merge(root, 'feature');
    write('a.txt', 'resolvido pela metade\n');
    expect(await rig.service.abortMerge(root)).toEqual({ needsConfirm: 'abort-merge', details: {} });
    expect((await rig.service.status(root)).state).toBe('merging');
    expect(await rig.service.abortMerge(root, ['abort-merge'])).toBeUndefined();
    const status = await rig.service.status(root);
    expect(status.state).toBe('normal');
    expect(status.changes).toEqual([]);
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(before);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('linha 1\nda main\nlinha 3\n');
  });

  it('refuses when no merge is in progress', async () => {
    expect((await failure(rig.service.abortMerge(root, ['abort-merge']))).code).toBe('INPUT_INVALID');
  });
});

describe('repository states started outside the app', () => {
  it('recognizes a merge started in the terminal', async () => {
    diverge();
    git(root, ['merge', '-q', '--no-commit', '--no-ff', 'feature']);
    const status = await rig.service.status(root);
    expect(status.state).toBe('merging');
    expect(status.branch).toBe('main');
  });

  it('recognizes a rebase stopped by a conflict and refuses to commit during it', async () => {
    conflict();
    expect(() => git(root, ['rebase', 'feature'])).toThrow();
    const status = await rig.service.status(root);
    expect(status.state).toBe('rebasing');
    const err = await failure(rig.service.commit(root, { paths: ['a.txt'], message: 'x', amend: false }));
    expect(err.code).toBe('INPUT_INVALID');
    expect(err.userMessage).toMatch(/fora do app/);
    expect((await failure(rig.service.merge(root, 'feature'))).code).toBe('INPUT_INVALID');
  });

  it('recognizes a cherry-pick stopped by a conflict', async () => {
    conflict();
    const pick = git(root, ['rev-parse', 'feature']).trim();
    expect(() => git(root, ['cherry-pick', pick])).toThrow();
    expect((await rig.service.status(root)).state).toBe('cherry-picking');
  });

  it('recognizes a detached head', async () => {
    git(root, ['checkout', '-q', '--detach']);
    const status = await rig.service.status(root);
    expect(status).toMatchObject({ state: 'detached', branch: null });
    expect(status.head).toBe(repo.head());
  });
});
