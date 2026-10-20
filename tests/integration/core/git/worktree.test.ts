import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../../../src/adapters/node-fs';
import { NodeProcessRunner } from '../../../../src/adapters/node-process-runner';
import { MelinnaError } from '../../../../src/core/errors';
import { freeBranchName } from '../../../../src/core/git/branch-name';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { acquireLease, readLease, releaseLease } from '../../../../src/core/git/lease';
import { inspectRepo } from '../../../../src/core/git/repo';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { assertWorktreePathFree, cleanResidue } from '../../../../src/core/git/residue';
import { createWorktree, listWorktrees, removeWorktree } from '../../../../src/core/git/worktree';
import { makePaths, repoIdOf, type AppPaths } from '../../../../src/core/paths';
import { currentOs } from '../../../support/os';
import { MemoryLogger } from '../../../support/fakes/logger';
import { createTempRepo, git as gitSync, type TempRepo } from '../../../support/git-fixture';
import {
  expectMainTreeUnchanged,
  snapshotMainTree,
  type MainTreeSnapshot,
} from '../../../support/main-tree-invariant';

const os = currentOs;
let repo: TempRepo;
let userData: string;
let paths: AppPaths;
let snap: MainTreeSnapshot;
const fs = new NodeFileSystem();
const log = new MemoryLogger();
const git = new GitRunner(new NodeProcessRunner(), log);
const mutex = new KeyedMutex();
const deps = { git, fs, mutex, log, os } as const;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as MelinnaError).code;
  }
  return 'none';
}

beforeEach(() => {
  repo = createTempRepo({ files: { 'src/a.txt': 'a\n' }, branches: ['dev'] });
  userData = mkdtempSync(join(tmpdir(), 'melinna-ud-'));
  paths = makePaths(userData, os);
  snap = snapshotMainTree(repo.root);
});

afterEach(() => {
  expectMainTreeUnchanged(repo.root, snap);
  repo.cleanup();
  rmSync(userData, { recursive: true, force: true });
});

describe('inspectRepo', () => {
  it('rejects non-git folders and missing refs', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'melinna-plain-'));
    try {
      expect(await code(inspectRepo(git, plain, 'main', os))).toBe('REPO_INVALID');
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
    expect(await code(inspectRepo(git, repo.root, 'nao-existe', os))).toBe('BASE_REF_NOT_FOUND');
    expect(await code(inspectRepo(git, repo.root, '--output=/tmp/x', os))).toBe('BASE_REF_NOT_FOUND');
  });

  it('resolves the base commit and counts uncommitted changes without touching the index', async () => {
    writeFileSync(join(repo.root, 'README.md'), 'mudou\n');
    writeFileSync(join(repo.root, 'novo.txt'), 'n\n');
    snap = snapshotMainTree(repo.root);
    const r = await inspectRepo(git, join(repo.root, 'src'), 'dev', os);
    expect(r.root).toBe(repo.root);
    expect(r.baseCommit).toBe(repo.head());
    expect(r.uncommittedCount).toBe(2);
  });
});

describe('lease and worktree', () => {
  const known = new Set<string>();
  const isKnown = (id: string) => known.has(id);

  async function prepare(execId: string, slug = 't', agent = 'claude') {
    const repoId = repoIdOf(repo.root, os);
    const worktreePath = paths.worktree(repoId, execId);
    await assertWorktreePathFree(
      { git, fs, mutex, os, paths },
      { repoRoot: repo.root, repoId, execId, isKnownExecution: isKnown },
    );
    await acquireLease({
      fs,
      os,
      leasePath: paths.lease(repoId, execId),
      lease: { execId, worktreePath, createdAt: 'now' },
      isKnownExecution: isKnown,
    });
    const branch = await freeBranchName(git, repo.root, `melinna/${slug}/${agent}`);
    await createWorktree(deps, {
      repoRoot: repo.root,
      repoId,
      branch,
      worktreePath,
      baseCommit: repo.head(),
    });
    return { repoId, worktreePath, branch };
  }

  beforeEach(() => known.clear());

  it('creates the worktree at the base commit inside userData with the lease taken first', async () => {
    known.add('e1');
    const { repoId, worktreePath, branch } = await prepare('e1');
    expect(worktreePath.startsWith(paths.worktreesRoot)).toBe(true);
    expect(gitSync(worktreePath, ['rev-parse', 'HEAD']).trim()).toBe(repo.head());
    expect(gitSync(worktreePath, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe(branch);
    expect(await readLease(fs, paths.lease(repoId, 'e1'))).toMatchObject({ execId: 'e1' });
    expect((await listWorktrees(git, repo.root)).length).toBe(2);
  });

  it('refuses a lease owned by another known execution and keeps it for the same one', async () => {
    known.add('e1');
    known.add('e2');
    const repoId = repoIdOf(repo.root, os);
    const leasePath = paths.lease(repoId, 'e1');
    const worktreePath = paths.worktree(repoId, 'e1');
    expect(
      await acquireLease({
        fs,
        os,
        leasePath,
        lease: { execId: 'e1', worktreePath, createdAt: '' },
        isKnownExecution: isKnown,
      }),
    ).toBe('acquired');
    expect(
      await acquireLease({
        fs,
        os,
        leasePath,
        lease: { execId: 'e1', worktreePath, createdAt: '' },
        isKnownExecution: isKnown,
      }),
    ).toBe('kept');
    expect(
      await code(
        acquireLease({
          fs,
          os,
          leasePath,
          lease: { execId: 'e2', worktreePath, createdAt: '' },
          isKnownExecution: isKnown,
        }),
      ),
    ).toBe('WORKTREE_IN_USE');
    await releaseLease(fs, leasePath);
    expect(await readLease(fs, leasePath)).toBeNull();
  });

  it('undoes the worktree and allows releasing the lease when creation fails', async () => {
    known.add('e1');
    const repoId = repoIdOf(repo.root, os);
    const worktreePath = paths.worktree(repoId, 'e1');
    gitSync(repo.root, ['branch', 'melinna/t/ocupada']);
    const failure = createWorktree(deps, {
      repoRoot: repo.root,
      repoId,
      branch: 'melinna/t/ocupada',
      worktreePath,
      baseCommit: repo.head(),
    });
    expect(await code(failure)).toBe('GIT_FAILED');
    expect(existsSync(worktreePath)).toBe(false);
    expect((await listWorktrees(git, repo.root)).length).toBe(1);
    // a branch que já existia não é apagada pelo desfazer
    expect(gitSync(repo.root, ['branch', '--list', 'melinna/t/ocupada']).trim()).toBe('melinna/t/ocupada');
    gitSync(repo.root, ['branch', '-D', 'melinna/t/ocupada']);
  });

  it('detects residues: loose directory, registered worktree without execution, orphan lease', async () => {
    const repoId = repoIdOf(repo.root, os);
    // diretório solto
    mkdirSync(paths.worktree(repoId, 'solto'), { recursive: true });
    known.add('solto');
    const loose = assertWorktreePathFree(
      { git, fs, mutex, os, paths },
      { repoRoot: repo.root, repoId, execId: 'solto', isKnownExecution: isKnown },
    );
    await expect(loose).rejects.toMatchObject({
      code: 'WORKTREE_RESIDUE',
      details: { residuePath: paths.worktree(repoId, 'solto') },
    });

    // worktree registrado sem execução
    known.add('reg');
    await prepare('reg', 'reg');
    rmSync(paths.lease(repoId, 'reg'));
    await expect(
      assertWorktreePathFree(
        { git, fs, mutex, os, paths },
        { repoRoot: repo.root, repoId, execId: 'reg', isKnownExecution: () => false },
      ),
    ).rejects.toMatchObject({ code: 'WORKTREE_RESIDUE' });

    // lease órfão
    writeFileSync(
      paths.lease(repoId, 'orfa'),
      JSON.stringify({ execId: 'fantasma', worktreePath: paths.worktree(repoId, 'orfa') }),
    );
    await expect(
      assertWorktreePathFree(
        { git, fs, mutex, os, paths },
        { repoRoot: repo.root, repoId, execId: 'orfa', isKnownExecution: isKnown },
      ),
    ).rejects.toMatchObject({ code: 'WORKTREE_RESIDUE' });

    // limpeza de cada resíduo
    const residueDeps = { git, fs, mutex, os, paths };
    for (const id of ['solto', 'reg', 'orfa']) {
      await cleanResidue(residueDeps, {
        residuePath: paths.worktree(repoId, id),
        repoRoot: null,
        isKnownExecution: () => false,
      });
      expect(existsSync(paths.worktree(repoId, id))).toBe(false);
      expect(existsSync(paths.lease(repoId, id))).toBe(false);
    }
    expect((await listWorktrees(git, repo.root)).length).toBe(1);
    gitSync(repo.root, ['branch', '-D', 'melinna/reg/claude']);
  });

  it('cleaning refuses paths outside the worktrees folder and paths with a valid lease', async () => {
    const residueDeps = { git, fs, mutex, os, paths };
    expect(
      await code(
        cleanResidue(residueDeps, { residuePath: repo.root, repoRoot: null, isKnownExecution: () => false }),
      ),
    ).toBe('INPUT_INVALID');
    expect(
      await code(
        cleanResidue(residueDeps, {
          residuePath: join(paths.worktreesRoot, '..', 'state.json'),
          repoRoot: null,
          isKnownExecution: () => false,
        }),
      ),
    ).toBe('INPUT_INVALID');
    known.add('viva');
    const { worktreePath } = await prepare('viva');
    expect(
      await code(
        cleanResidue(residueDeps, {
          residuePath: worktreePath,
          repoRoot: repo.root,
          isKnownExecution: isKnown,
        }),
      ),
    ).toBe('WORKTREE_IN_USE');
    expect(existsSync(worktreePath)).toBe(true);
    await removeWorktree(deps, {
      repoRoot: repo.root,
      repoId: repoIdOf(repo.root, os),
      worktreePath,
      force: true,
    });
    gitSync(repo.root, ['branch', '-D', 'melinna/t/claude']);
  });

  it('prepares 6 worktrees concurrently in the same repo without lock errors, with suffixes on collision', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const id of ids) known.add(id);
    // a mesma tarefa e agente para todos força sufixos; o mutex serializa a escolha do nome e o worktree add
    const results = await Promise.all(ids.map((id) => mutex.run('names', () => prepare(id))));
    expect(new Set(results.map((r) => r.branch)).size).toBe(6);
    expect(results.map((r) => r.branch)).toContain('melinna/t/claude-6');
    expect((await listWorktrees(git, repo.root)).length).toBe(7);
    for (const r of results) {
      await removeWorktree(deps, {
        repoRoot: repo.root,
        repoId: r.repoId,
        worktreePath: r.worktreePath,
        force: false,
      });
      gitSync(repo.root, ['branch', '-D', r.branch]);
    }
    expect((await listWorktrees(git, repo.root)).length).toBe(1);
  });
});
