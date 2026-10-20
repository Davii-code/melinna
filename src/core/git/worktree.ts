import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import type { GitRunner } from './git-runner';
import type { KeyedMutex } from './repo-mutex';

export interface WorktreeDeps {
  git: GitRunner;
  fs: FileSystem;
  mutex: KeyedMutex;
  log: Logger;
  os: OsName;
}

export interface CreateWorktreeInput {
  repoRoot: string;
  repoId: string;
  branch: string;
  worktreePath: string;
  baseCommit: string;
}

function samePath(a: string, b: string, os: OsName): boolean {
  const p = pathModule(os);
  const na = p.resolve(a);
  const nb = p.resolve(b);
  return os === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** Caminhos de worktrees registrados no repositório (`git worktree list --porcelain`). */
export async function listWorktrees(git: GitRunner, repoRoot: string): Promise<string[]> {
  const r = await git.run(['worktree', 'list', '--porcelain', '-z'], { cwd: repoRoot, read: true });
  return r.stdout
    .split('\0')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

export async function isRegisteredWorktree(
  git: GitRunner,
  repoRoot: string,
  path: string,
  os: OsName,
): Promise<boolean> {
  return (await listWorktrees(git, repoRoot)).some((w) => samePath(w, path, os));
}

/**
 * Cria branch e worktree a partir do commit base, sob o mutex do repositório.
 * Em falha, desfaz o que tiver sido criado (worktree, diretório e branch).
 */
export async function createWorktree(deps: WorktreeDeps, input: CreateWorktreeInput): Promise<void> {
  const { git, fs, mutex, log } = deps;
  await mutex.run(input.repoId, async () => {
    await fs.mkdir(pathModule(deps.os).dirname(input.worktreePath), { recursive: true });
    const branchExisted = await branchExists(git, input.repoRoot, input.branch);
    const started = Date.now();
    try {
      await git.run(
        ['worktree', 'add', '--quiet', '-b', input.branch, '--', input.worktreePath, input.baseCommit],
        {
          cwd: input.repoRoot,
        },
      );
      log.info('worktree.created', { repoId: input.repoId, durationMs: Date.now() - started });
    } catch (err) {
      await undoCreate(deps, input, branchExisted).catch((undoErr: unknown) =>
        log.error('worktree.undo_failed', { err: undoErr }),
      );
      throw err;
    }
  });
}

async function branchExists(git: GitRunner, repoRoot: string, branch: string): Promise<boolean> {
  const r = await git.run(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: repoRoot,
    read: true,
    allowFail: true,
  });
  return r.exitCode === 0;
}

/** Desfaz uma criação que falhou; nunca apaga uma branch que já existia antes. */
async function undoCreate(
  deps: WorktreeDeps,
  input: CreateWorktreeInput,
  branchExisted: boolean,
): Promise<void> {
  const { git, fs } = deps;
  if (await isRegisteredWorktree(git, input.repoRoot, input.worktreePath, deps.os)) {
    await git.run(['worktree', 'remove', '--force', '--', input.worktreePath], {
      cwd: input.repoRoot,
      allowFail: true,
    });
  }
  await fs.rm(input.worktreePath, { recursive: true, force: true });
  await git.run(['worktree', 'prune'], { cwd: input.repoRoot, allowFail: true });
  if (!branchExisted && (await branchExists(git, input.repoRoot, input.branch))) {
    await git.run(['branch', '-D', '--', input.branch], { cwd: input.repoRoot, allowFail: true });
  }
}

export interface RemoveWorktreeInput {
  repoRoot: string;
  repoId: string;
  worktreePath: string;
  force: boolean;
}

/** Remove o worktree registrado e o diretório, e roda `git worktree prune`. */
export async function removeWorktree(deps: WorktreeDeps, input: RemoveWorktreeInput): Promise<void> {
  const { git, fs, mutex, log } = deps;
  await mutex.run(input.repoId, async () => {
    if (await isRegisteredWorktree(git, input.repoRoot, input.worktreePath, deps.os)) {
      await git.run(['worktree', 'remove', ...(input.force ? ['--force'] : []), '--', input.worktreePath], {
        cwd: input.repoRoot,
      });
    }
    await fs.rm(input.worktreePath, { recursive: true, force: true });
    await git.run(['worktree', 'prune'], { cwd: input.repoRoot, allowFail: true });
    log.info('worktree.removed', { repoId: input.repoId });
  });
}
