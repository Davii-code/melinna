import type { AgentPick } from '../api-types';
import { resolveModel, resolvePermission } from '../catalog/launch-plan';
import { MelinnaError, toIpcError } from '../errors';
import { branchNameFor, freeBranchName } from '../git/branch-name';
import { acquireLease, releaseLease } from '../git/lease';
import { assertWorktreePathFree } from '../git/residue';
import { createWorktree } from '../git/worktree';
import { newId } from '../ids';
import type { Execution, Task } from '../persistence/state-schema';
import type { ExecutionContext } from './context';

export type { AgentPick };

/** Cria o registro da execução em `preparing`, com o próximo índice de faixa da tarefa. */
export function createExecutionRecord(ctx: ExecutionContext, task: Task, pick: AgentPick): Execution {
  const existing = ctx.model.executionsOf(task.id);
  const next = Math.max(task.nextBandIndex ?? 0, ...existing.map((e) => e.bandIndex + 1), 0);
  const id = newId();
  const exec: Execution = {
    id,
    taskId: task.id,
    agentId: pick.agentId,
    bandIndex: next,
    model: pick.model ?? null,
    permissionMode: pick.permission ?? null,
    branch: '',
    worktreePath: ctx.paths.worktree(task.repoId, id),
    baseCommit: task.baseCommit,
    status: 'preparing',
    pendingSwitch: null,
    pid: null,
    exitCode: null,
    signal: null,
    startedAt: null,
    endedAt: null,
    launchCount: 0,
    failure: null,
  };
  ctx.model.mutate((s) => {
    s.executions.push(exec);
    const t = s.tasks.find((x) => x.id === task.id);
    if (t) t.nextBandIndex = next + 1;
  });
  return exec;
}

/**
 * Prepara uma execução: valida agente, modelo e modo; escolhe branch livre; adquire o lease;
 * cria o worktree no commit base. Em falha, desfaz só o que foi criado para esta execução.
 */
export async function prepareExecution(
  ctx: ExecutionContext,
  task: Task,
  exec: Execution,
  reservedBranches: Set<string>,
): Promise<void> {
  const leasePath = ctx.paths.lease(task.repoId, exec.id);
  let leaseTaken = false;
  try {
    const def = await ctx.catalog.agent(exec.agentId);
    const model = resolveModel(def, exec.model);
    const permission = resolvePermission(def, exec.permissionMode);
    ctx.update(exec.id, { model, permissionMode: permission });

    await ctx.mutex.run(`prepare:${task.repoId}`, async () => {
      await assertWorktreePathFree(
        { git: ctx.git, fs: ctx.fs, mutex: ctx.mutex, os: ctx.os, paths: ctx.paths },
        {
          repoRoot: task.repoPath,
          repoId: task.repoId,
          execId: exec.id,
          isKnownExecution: (id) => ctx.model.execution(id) !== undefined,
        },
      );
      await acquireLease({
        fs: ctx.fs,
        os: ctx.os,
        leasePath,
        lease: { execId: exec.id, worktreePath: exec.worktreePath, createdAt: ctx.clock.now().toISOString() },
        isKnownExecution: (id) => ctx.model.execution(id) !== undefined,
      });
      leaseTaken = true;
      const branch = await freeBranchName(
        ctx.git,
        task.repoPath,
        branchNameFor(task.slug, exec.agentId),
        reservedBranches,
      );
      reservedBranches.add(branch);
      await createWorktree(
        { git: ctx.git, fs: ctx.fs, mutex: ctx.mutex, log: ctx.log, os: ctx.os },
        {
          repoRoot: task.repoPath,
          repoId: task.repoId,
          branch,
          worktreePath: exec.worktreePath,
          baseCommit: task.baseCommit,
        },
      );
      ctx.update(exec.id, { branch, status: 'starting' });
    });
  } catch (err) {
    if (leaseTaken) await releaseLease(ctx.fs, leasePath).catch(() => undefined);
    const e = toIpcError(err);
    ctx.update(exec.id, { status: 'failed_to_start', failure: { code: e.code, message: e.message } });
    ctx.log.warn('execution.prepare_failed', { execId: exec.id, agentId: exec.agentId, code: e.code });
    if (!(err instanceof MelinnaError)) ctx.log.error('execution.prepare_internal', { execId: exec.id, err });
    throw err;
  }
}
