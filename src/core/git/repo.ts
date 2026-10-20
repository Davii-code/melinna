import type { RepoInspection } from '../api-types';
import { MelinnaError } from '../errors';
import { pathModule } from '../paths';
import type { OsName } from '../ports/platform';
import type { GitRunner } from './git-runner';

export type { RepoInspection };

/** Conta entradas de `git status --porcelain=v1 -z` (renomeações têm um caminho extra). */
export function countPorcelainEntries(out: string): number {
  const parts = out.split('\0');
  let count = 0;
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    count++;
    const x = entry[0];
    if (x === 'R' || x === 'C') i++;
  }
  return count;
}

export function assertSafeRef(ref: string): void {
  if (
    ref.length === 0 ||
    ref.length > 256 ||
    ref.startsWith('-') ||
    /[\s\0~^:?*[\\]/.test(ref.replace(/\^\{commit\}$/, ''))
  ) {
    throw new MelinnaError('BASE_REF_NOT_FOUND', { userMessage: `Ponto de partida inválido: ${ref}` });
  }
}

export async function repoRoot(git: GitRunner, repoPath: string, os: OsName): Promise<string> {
  const r = await git
    .run(['rev-parse', '--show-toplevel'], { cwd: repoPath, read: true, allowFail: true })
    .catch((cause: unknown) => {
      throw new MelinnaError('REPO_INVALID', { userMessage: `${repoPath} não é um repositório git.`, cause });
    });
  const top = r.stdout.trim();
  if (r.exitCode !== 0 || top.length === 0) {
    throw new MelinnaError('REPO_INVALID', { userMessage: `${repoPath} não é um repositório git.` });
  }
  return pathModule(os).resolve(top);
}

export async function resolveCommit(git: GitRunner, root: string, ref: string): Promise<string> {
  assertSafeRef(ref);
  const r = await git.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: root,
    read: true,
    allowFail: true,
  });
  const sha = r.stdout.trim();
  if (r.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    throw new MelinnaError('BASE_REF_NOT_FOUND', {
      userMessage: `O ponto de partida ${ref} não existe no repositório.`,
    });
  }
  return sha;
}

export async function uncommittedCount(git: GitRunner, root: string): Promise<number> {
  const r = await git.run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
    read: true,
  });
  return countPorcelainEntries(r.stdout);
}

/** Valida repositório e ponto de partida sem escrever nada no repositório. */
export async function inspectRepo(
  git: GitRunner,
  repoPath: string,
  baseRef: string,
  os: OsName,
): Promise<RepoInspection> {
  const root = await repoRoot(git, repoPath, os);
  const baseCommit = await resolveCommit(git, root, baseRef);
  return { root, baseCommit, uncommittedCount: await uncommittedCount(git, root) };
}
