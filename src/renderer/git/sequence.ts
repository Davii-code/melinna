import type { Confirm, GitProgress, MelinnaApi, NeedsConfirm, Result } from '../../shared/ipc-contract';
import { isNeedsConfirm } from '../components/Git/git-ui';
import type { PlanItem, RepoView } from './git-store';

export type GitApi = MelinnaApi['git'];

export interface StepResult {
  root: string;
  name: string;
  /** `skipped`: o usuário recusou a confirmação deste repositório. */
  outcome: 'ok' | 'skipped' | 'error';
  sha?: string;
  message?: string;
  conflicts?: string[];
}

/** Pergunta ao usuário; `false` = recusou. */
export type Ask = (request: NeedsConfirm, repo: RepoView) => Promise<boolean>;

/** Espera o fim de uma operação de rede (evento `done` do `gitProgress`). */
export type WaitOp = (opId: string, ctx: { root: string; kind: 'fetch' | 'pull' | 'push' }) => Promise<GitProgress>;

const errorStep = (repo: RepoView, message: string): StepResult => ({
  root: repo.root,
  name: repo.name,
  outcome: 'error',
  message,
});
const skippedStep = (repo: RepoView): StepResult => ({ root: repo.root, name: repo.name, outcome: 'skipped' });

/** Commits em sequência, mesma mensagem; para no primeiro erro mantendo os já feitos. */
export async function commitAll(
  git: GitApi,
  plan: readonly PlanItem[],
  message: string,
  amend: boolean,
  ask: Ask,
): Promise<{ results: StepResult[]; failed: boolean }> {
  const results: StepResult[] = [];
  for (const { repo, paths } of plan) {
    const confirm: Confirm[] = [];
    for (;;) {
      const input = { paths, message, amend };
      const r = await git.commit(repo.root, confirm.length > 0 ? { ...input, confirm: [...confirm] } : input);
      if (!r.ok) {
        results.push(errorStep(repo, r.error.message));
        return { results, failed: true };
      }
      if (isNeedsConfirm(r.value)) {
        if (!(await ask(r.value, repo))) {
          results.push(skippedStep(repo));
          break;
        }
        confirm.push(r.value.needsConfirm);
        continue;
      }
      results.push({ root: repo.root, name: repo.name, outcome: 'ok', sha: r.value.sha });
      break;
    }
  }
  return { results, failed: false };
}

type Net = 'fetch' | 'pull' | 'push';

async function runNet(git: GitApi, kind: Net, repo: RepoView, ask: Ask | null, wait: WaitOp): Promise<StepResult> {
  const confirm: Confirm[] = [];
  for (;;) {
    let started: Result<{ opId: string } | NeedsConfirm>;
    if (kind === 'fetch') started = await git.fetch(repo.root);
    else started = await (confirm.length > 0 ? git[kind](repo.root, [...confirm]) : git[kind](repo.root));
    if (!started.ok) return errorStep(repo, started.error.message);
    if (isNeedsConfirm(started.value)) {
      if (!ask || !(await ask(started.value, repo))) return skippedStep(repo);
      confirm.push(started.value.needsConfirm);
      continue;
    }
    const end = await wait(started.value.opId, { root: repo.root, kind });
    if (end.error) return errorStep(repo, end.error.message);
    const conflicts = end.result?.conflicts;
    return {
      root: repo.root,
      name: repo.name,
      outcome: 'ok',
      ...(conflicts && conflicts.length > 0 ? { conflicts } : {}),
    };
  }
}

async function runAll(git: GitApi, kind: Net, repos: readonly RepoView[], ask: Ask | null, wait: WaitOp) {
  const results: StepResult[] = [];
  for (const repo of repos) results.push(await runNet(git, kind, repo, ask, wait));
  return results;
}

export const fetchAll = (git: GitApi, repos: readonly RepoView[], wait: WaitOp) =>
  runAll(git, 'fetch', repos, null, wait);

export const pullAll = (git: GitApi, repos: readonly RepoView[], ask: Ask, wait: WaitOp) =>
  runAll(git, 'pull', repos, ask, wait);

export const pushAll = (git: GitApi, repos: readonly RepoView[], ask: Ask, wait: WaitOp) =>
  runAll(git, 'push', repos, ask, wait);

/** Commit em todos e, só se todos deram certo, push de cada repositório commitado. */
export async function commitAndPush(
  git: GitApi,
  plan: readonly PlanItem[],
  message: string,
  amend: boolean,
  ask: Ask,
  wait: WaitOp,
): Promise<{ commits: { results: StepResult[]; failed: boolean }; pushes: StepResult[] }> {
  const commits = await commitAll(git, plan, message, amend, ask);
  if (commits.failed) return { commits, pushes: [] };
  const committed = new Set(commits.results.filter((r) => r.outcome === 'ok').map((r) => r.root));
  const repos = plan.map((p) => p.repo).filter((r) => committed.has(r.root));
  return { commits, pushes: await pushAll(git, repos, ask, wait) };
}
