import { MelinnaError } from '../errors';
import type { GitRunner } from './git-runner';

export const SLUG_MAX = 40;

/** Reduz um título a `[a-z0-9-]`, até 40 caracteres; vazio vira `tarefa`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'tarefa';
}

export function branchNameFor(slug: string, agentId: string): string {
  return `melinna/${slug}/${agentId}`;
}

async function branchExists(git: GitRunner, repoRoot: string, name: string): Promise<boolean> {
  const r = await git.run(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {
    cwd: repoRoot,
    read: true,
    allowFail: true,
  });
  return r.exitCode === 0;
}

async function validBranchName(git: GitRunner, repoRoot: string, name: string): Promise<boolean> {
  const r = await git.run(['check-ref-format', '--branch', name], {
    cwd: repoRoot,
    read: true,
    allowFail: true,
  });
  return r.exitCode === 0;
}

/** Devolve o primeiro nome livre: `base`, `base-2`, `base-3`… Nunca reaproveita branch existente. */
export async function freeBranchName(
  git: GitRunner,
  repoRoot: string,
  base: string,
  reserved: ReadonlySet<string> = new Set(),
): Promise<string> {
  if (!(await validBranchName(git, repoRoot, base))) {
    throw new MelinnaError('BRANCH_INVALID', { userMessage: `Nome de branch inválido: ${base}` });
  }
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (reserved.has(candidate)) continue;
    if (!(await branchExists(git, repoRoot, candidate))) return candidate;
  }
  throw new MelinnaError('BRANCH_INVALID', { userMessage: `Não há nome livre para a branch ${base}.` });
}
