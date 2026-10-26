import type { RemovalCheck } from '../api-types';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import type { GitRunner } from './git-runner';
import { releaseLease } from './lease';
import type { KeyedMutex } from './repo-mutex';
import { removeWorktree } from './worktree';

export interface RemovalDeps {
  git: GitRunner;
  fs: FileSystem;
  mutex: KeyedMutex;
  log: Logger;
  os: OsName;
}

export interface RemovalTarget {
  repoRoot: string;
  repoId: string;
  worktreePath: string;
  /** Vazio quando o preparo falhou antes de criar a branch. */
  branch: string;
  baseRef: string;
  baseCommit: string;
  leasePath: string;
}

async function branchExists(git: GitRunner, repoRoot: string, branch: string): Promise<boolean> {
  if (!branch) return false;
  const r = await git.run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoRoot,
    read: true,
    allowFail: true,
  });
  return r.exitCode === 0;
}

/** Ponto de comparação dos commits: a base informada, se ainda resolve; senão o commit base gravado. */
async function comparisonBase(git: GitRunner, t: RemovalTarget): Promise<string> {
  const r = await git.run(['rev-parse', '--verify', '--quiet', `${t.baseRef}^{commit}`], {
    cwd: t.repoRoot,
    read: true,
    allowFail: true,
  });
  const sha = r.stdout.trim();
  return r.exitCode === 0 && sha ? sha : t.baseCommit;
}

function countEntries(porcelainZ: string): number {
  // `status --porcelain=v1 -z`: renomeações trazem o caminho de origem como entrada extra sem código.
  let count = 0;
  const parts = porcelainZ.split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i] ?? '';
    if (entry.length < 3) continue;
    count += 1;
    if (entry[0] === 'R' || entry[0] === 'C') i += 1;
  }
  return count;
}

/** Conta o trabalho que uma remoção perderia: arquivos não commitados e commits da branch fora da base. */
export async function removalCheck(deps: RemovalDeps, t: RemovalTarget): Promise<RemovalCheck> {
  let uncommittedFiles = 0;
  if (await deps.fs.exists(t.worktreePath)) {
    const st = await deps.git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
      cwd: t.worktreePath,
      read: true,
    });
    uncommittedFiles = countEntries(st.stdout);
  }
  let unmergedCommits = 0;
  if (await branchExists(deps.git, t.repoRoot, t.branch)) {
    const base = await comparisonBase(deps.git, t);
    const r = await deps.git.run(['rev-list', '--count', `${base}..refs/heads/${t.branch}`], {
      cwd: t.repoRoot,
      read: true,
    });
    const n = Number.parseInt(r.stdout.trim(), 10);
    unmergedCommits = Number.isFinite(n) && n > 0 ? n : 0;
  }
  return { uncommittedFiles, unmergedCommits, branch: t.branch };
}

/**
 * Remove worktree (forçado só com `force`), a branch quando pedido e o lease. A conferência de trabalho
 * perdido é feita antes por quem chama contra a base da tarefa; por isso a branch sai com `-D`, já que `-d`
 * compararia com o HEAD do repositório principal, que pode não ser a base.
 */
export async function removeExecutionArtifacts(
  deps: RemovalDeps,
  t: RemovalTarget,
  opts: { deleteBranch: boolean; force: boolean },
): Promise<void> {
  await removeWorktree(deps, {
    repoRoot: t.repoRoot,
    repoId: t.repoId,
    worktreePath: t.worktreePath,
    force: opts.force,
  });
  if (opts.deleteBranch && (await branchExists(deps.git, t.repoRoot, t.branch))) {
    await deps.mutex.run(t.repoId, () => deps.git.run(['branch', '-D', '--', t.branch], { cwd: t.repoRoot }));
    deps.log.info('branch.deleted', { repoId: t.repoId, forced: opts.force });
  }
  await releaseLease(deps.fs, t.leasePath);
}
