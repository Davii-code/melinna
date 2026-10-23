import { toIpcError } from '../../core/errors';
import { newId } from '../../core/ids';
import type { GitIo, GitService } from '../../core/git/git-service';
import type { GitProgress, OpStarted } from '../../core/git/git-types';
import { normalizeRepoPath } from '../../core/paths';
import type { Logger } from '../../core/ports/logger';
import type { OsName } from '../../core/ports/platform';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { invalid } from './validate-common';
import { gitParsers } from './validate-git';

export type GitApi = Pick<
  GitService,
  | 'status'
  | 'diffFile'
  | 'commit'
  | 'discard'
  | 'checkPull'
  | 'checkPush'
  | 'fetch'
  | 'pull'
  | 'push'
  | 'branches'
  | 'createBranch'
  | 'checkout'
  | 'merge'
  | 'abortMerge'
  | 'markResolved'
  | 'log'
  | 'commitDiff'
>;

export interface GitIpcDeps {
  git: GitApi;
  /** Raízes das pastas dos workspaces abertos: `repo` só vale se for uma delas. */
  roots: () => string[];
  os: OsName;
  emit: (event: GitProgress) => void;
  log: Logger;
  newOpId?: () => string;
}

/** Canais de git: leituras, commit, descarte, rede com progresso e cancelamento, branches, merge e histórico. */
export function registerGit(handle: Handle, deps: GitIpcDeps): void {
  const { git, log, emit } = deps;
  const C = CHANNELS.git;
  const newOpId = deps.newOpId ?? newId;
  const isRoot = (path: string) => {
    const wanted = normalizeRepoPath(path, deps.os);
    return deps.roots().some((root) => normalizeRepoPath(root, deps.os) === wanted);
  };
  const parse = gitParsers(isRoot);
  const ops = new Map<string, AbortController>();

  /** Corre a operação em segundo plano: o progresso e o fim saem pelo evento `gitProgress`. */
  const start = (
    phase: string,
    run: (io: GitIo) => Promise<{ conflicts?: string[] } | void>,
  ): OpStarted => {
    const opId = newOpId();
    const controller = new AbortController();
    ops.set(opId, controller);
    const io: GitIo = {
      signal: controller.signal,
      onProgress: (p, percent) => emit({ opId, phase: p, ...(percent === undefined ? {} : { percent }) }),
    };
    void run(io)
      .then(
        (result) =>
          emit({
            opId,
            phase,
            done: true,
            ...(result && result.conflicts ? { result: { conflicts: result.conflicts } } : {}),
          }),
        (err: unknown) => emit({ opId, phase, done: true, error: toIpcError(err) }),
      )
      .catch((err: unknown) => log.error('git.progress_emit_failed', { err }))
      .finally(() => ops.delete(opId));
    return { opId };
  };

  handle(
    C.status,
    handler(log, C.status, parse.repoOnly, (repo) => git.status(repo)),
  );
  handle(
    C.diffFile,
    handler(log, C.diffFile, parse.diffFile, (repo, path) => git.diffFile(repo, path)),
  );
  handle(
    C.commit,
    handler(log, C.commit, parse.commit, (repo, input) => git.commit(repo, input)),
  );
  handle(
    C.discard,
    handler(log, C.discard, parse.discard, (repo, paths, confirm) => git.discard(repo, paths, confirm)),
  );
  handle(
    C.fetch,
    handler(log, C.fetch, parse.repoOnly, (repo) => start('fetch', (io) => git.fetch(repo, io))),
  );
  handle(
    C.pull,
    handler(log, C.pull, parse.repoConfirm, async (repo, confirm) => {
      const needs = await git.checkPull(repo, confirm);
      return needs ?? start('pull', (io) => git.pull(repo, { ...io, confirm }));
    }),
  );
  handle(
    C.push,
    handler(log, C.push, parse.repoConfirm, async (repo, confirm) => {
      const needs = await git.checkPush(repo, confirm);
      return needs ?? start('push', (io) => git.push(repo, { ...io, confirm }));
    }),
  );
  handle(
    C.cancel,
    handler(log, C.cancel, parse.opId, (opId) => {
      const controller = ops.get(opId);
      if (!controller) throw invalid('operação');
      controller.abort();
    }),
  );
  handle(
    C.branches,
    handler(log, C.branches, parse.repoOnly, (repo) => git.branches(repo)),
  );
  handle(
    C.createBranch,
    handler(log, C.createBranch, parse.branchName, (repo, name) => git.createBranch(repo, name)),
  );
  handle(
    C.checkout,
    handler(log, C.checkout, parse.branchConfirm, (repo, branch, confirm) => git.checkout(repo, branch, confirm)),
  );
  handle(
    C.merge,
    handler(log, C.merge, parse.branchConfirm, (repo, branch, confirm) => git.merge(repo, branch, confirm)),
  );
  handle(
    C.abortMerge,
    handler(log, C.abortMerge, parse.repoConfirm, (repo, confirm) => git.abortMerge(repo, confirm)),
  );
  handle(
    C.markResolved,
    handler(log, C.markResolved, parse.markResolved, (repo, paths) => git.markResolved(repo, paths)),
  );
  handle(
    C.log,
    handler(log, C.log, parse.log, (repo, skip) => git.log(repo, skip)),
  );
  handle(
    C.commitDiff,
    handler(log, C.commitDiff, parse.commitDiff, (repo, sha, path) => git.commitDiff(repo, sha, path)),
  );
}
