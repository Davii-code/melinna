import { MelinnaError } from '../errors';
import type { AppPaths } from '../paths';
import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { OsName } from '../ports/platform';
import type { GitRunner } from './git-runner';
import { readLease, releaseLease } from './lease';
import type { KeyedMutex } from './repo-mutex';
import { isRegisteredWorktree } from './worktree';

export interface ResidueDeps {
  git: GitRunner;
  fs: FileSystem;
  mutex: KeyedMutex;
  os: OsName;
  paths: AppPaths;
}

function residue(residuePath: string, why: string): MelinnaError {
  return new MelinnaError('WORKTREE_RESIDUE', {
    userMessage: `Há um resíduo de worktree em ${residuePath} (${why}). Use "Limpar resíduo" para removê-lo.`,
    details: { residuePath },
  });
}

/**
 * Confere que o caminho do worktree de uma execução nova está livre: sem lease de outra execução,
 * sem diretório solto e sem registro no git. Lança WORKTREE_IN_USE ou WORKTREE_RESIDUE.
 */
export async function assertWorktreePathFree(
  deps: ResidueDeps,
  input: { repoRoot: string; repoId: string; execId: string; isKnownExecution: (id: string) => boolean },
): Promise<void> {
  const worktreePath = deps.paths.worktree(input.repoId, input.execId);
  const lease = await readLease(deps.fs, deps.paths.lease(input.repoId, input.execId));
  if (lease === 'unreadable') throw residue(worktreePath, 'registro de posse ilegível');
  if (lease && lease.execId !== input.execId) {
    if (input.isKnownExecution(lease.execId)) {
      throw new MelinnaError('WORKTREE_IN_USE', {
        userMessage: `Worktree em uso pela execução ${lease.execId}.`,
        details: { ownerExecId: lease.execId },
      });
    }
    throw residue(worktreePath, 'registro de posse sem execução');
  }
  if (lease && lease.execId === input.execId && !input.isKnownExecution(input.execId)) {
    throw residue(worktreePath, 'registro de posse sem execução');
  }
  if (await isRegisteredWorktree(deps.git, input.repoRoot, worktreePath, deps.os)) {
    throw residue(worktreePath, 'worktree registrado no git sem execução');
  }
  if (await deps.fs.exists(worktreePath)) throw residue(worktreePath, 'diretório solto');
}

/** Descobre o repositório principal de um worktree pelo arquivo `.git` (`gitdir: <repo>/.git/worktrees/<nome>`). */
async function mainRepoOf(deps: ResidueDeps, worktreePath: string): Promise<string | null> {
  const p = pathModule(deps.os);
  try {
    const text = new TextDecoder().decode(await deps.fs.readFile(p.join(worktreePath, '.git')));
    const m = /^gitdir:\s*(.+)$/m.exec(text);
    if (!m?.[1]) return null;
    const gitdir = p.resolve(worktreePath, m[1].trim());
    const worktreesDir = p.dirname(gitdir);
    if (p.basename(worktreesDir) !== 'worktrees') return null;
    return p.dirname(p.dirname(worktreesDir));
  } catch {
    return null;
  }
}

export interface CleanResidueInput {
  residuePath: string;
  /** Raiz do repositório, quando conhecida por uma tarefa com o mesmo repoId. */
  repoRoot: string | null;
  isKnownExecution: (id: string) => boolean;
}

/**
 * Remove um resíduo: worktree registrado (`worktree remove --force`), diretório solto e lease, depois `worktree prune`.
 * Só aceita caminhos dentro da pasta de worktrees do app e recusa caminhos com lease válido.
 */
export async function cleanResidue(deps: ResidueDeps, input: CleanResidueInput): Promise<void> {
  const p = pathModule(deps.os);
  const target = p.resolve(input.residuePath);
  if (!deps.paths.isInsideWorktrees(target)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: 'A limpeza só aceita caminhos dentro da pasta de worktrees do app.',
    });
  }
  const rel = p.relative(deps.paths.worktreesRoot, target).split(p.sep);
  if (rel.length !== 2 || !rel[0] || !rel[1]) {
    throw new MelinnaError('INPUT_INVALID', { userMessage: 'Caminho de resíduo inválido.' });
  }
  const repoId = rel[0];
  const execId = rel[1].replace(/\.lease$/, '');
  const worktreePath = deps.paths.worktree(repoId, execId);
  const leasePath = deps.paths.lease(repoId, execId);
  const lease = await readLease(deps.fs, leasePath);
  if (lease && lease !== 'unreadable' && input.isKnownExecution(lease.execId)) {
    throw new MelinnaError('WORKTREE_IN_USE', {
      userMessage: `Worktree em uso pela execução ${lease.execId}.`,
      details: { ownerExecId: lease.execId },
    });
  }
  const repo = input.repoRoot ?? (await mainRepoOf(deps, worktreePath));
  await deps.mutex.run(repoId, async () => {
    if (repo && (await isRegisteredWorktree(deps.git, repo, worktreePath, deps.os))) {
      await deps.git.run(['worktree', 'remove', '--force', '--', worktreePath], {
        cwd: repo,
        allowFail: true,
      });
    }
    await deps.fs.rm(worktreePath, { recursive: true, force: true });
    await releaseLease(deps.fs, leasePath);
    if (repo) await deps.git.run(['worktree', 'prune'], { cwd: repo, allowFail: true });
  });
}

/** Leases cujo execId não existe no estado: resíduos detectados na abertura do app. */
export async function findOrphanLeases(
  deps: Pick<ResidueDeps, 'fs' | 'paths' | 'os'>,
  isKnownExecution: (id: string) => boolean,
): Promise<string[]> {
  const p = pathModule(deps.os);
  if (!(await deps.fs.exists(deps.paths.worktreesRoot))) return [];
  const out: string[] = [];
  for (const repoId of await deps.fs.readdir(deps.paths.worktreesRoot)) {
    const dir = p.join(deps.paths.worktreesRoot, repoId);
    let names: string[];
    try {
      names = await deps.fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names.filter((n) => n.endsWith('.lease'))) {
      const lease = await readLease(deps.fs, p.join(dir, name));
      const execId = name.slice(0, -'.lease'.length);
      if (lease === 'unreadable' || !lease || !isKnownExecution(lease.execId))
        out.push(deps.paths.worktree(repoId, execId));
    }
  }
  return out;
}
