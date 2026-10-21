import type { Logger } from '../ports/logger';
import type { GitRunner } from './git-runner';

/**
 * Quantos commits a base avançou desde o commit em que o worktree foi criado
 * (`rev-list --count <baseCommit>..<base atual>`). Base que não resolve mais: 0, com aviso no log.
 */
export async function baseAdvancedBy(
  deps: { git: GitRunner; log: Logger },
  input: { repoRoot: string; baseRef: string; baseCommit: string },
): Promise<number> {
  const resolved = await deps.git.run(['rev-parse', '--verify', '--quiet', `${input.baseRef}^{commit}`], {
    cwd: input.repoRoot,
    read: true,
    allowFail: true,
  });
  const head = resolved.stdout.trim();
  if (resolved.exitCode !== 0 || !head) {
    deps.log.warn('divergence.base_missing');
    return 0;
  }
  const r = await deps.git.run(['rev-list', '--count', `${input.baseCommit}..${head}`], {
    cwd: input.repoRoot,
    read: true,
  });
  const n = Number.parseInt(r.stdout.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
