import type { AgentPick } from '../api-types';
import { resolveModel, resolvePermission } from '../catalog/launch-plan';
import { MelinnaError, toIpcError } from '../errors';
import { branchNameFor, freeBranchName } from '../git/branch-name';
import { acquireLease, releaseLease } from '../git/lease';
import { assertWorktreePathFree } from '../git/residue';
import { createWorktree } from '../git/worktree';
import { newId } from '../ids';
import { isDirect, type Execution, type Task } from '../persistence/state-schema';
import { COMMAND_AGENT_ID, type ExecutionCommand } from '../run/types';
import type { ExecutionContext } from './context';

/** Pasta que existe e pode ser lida: uma pasta sem permissão de leitura conta como indisponível. */
export async function isUsableFolder(ctx: ExecutionContext, folder: string): Promise<boolean> {
  const stat = await ctx.fs.stat(folder).catch(() => null);
  if (!stat?.isDirectory) return false;
  return ctx.fs
    .readdir(folder)
    .then(() => true)
    .catch(() => false);
}

/**
 * Na execução direta, a pasta da tarefa precisa continuar existindo: é o cwd do processo. Num workspace
 * ela é a pasta principal, e a mensagem diz isso.
 */
export async function assertFolderExists(
  ctx: ExecutionContext,
  folder: string,
  task?: Pick<Task, 'groupId'>,
): Promise<void> {
  if (await isUsableFolder(ctx, folder)) return;
  const inWorkspace = task !== undefined && ctx.model.group(task.groupId)?.folders !== undefined;
  throw new MelinnaError('INPUT_INVALID', {
    userMessage: inWorkspace
      ? `A pasta principal ${folder} não está disponível.`
      : `A pasta ${folder} não existe mais.`,
  });
}

/** Separa as pastas extras da tarefa em utilizáveis agora e indisponíveis (omitidas com aviso). */
export async function resolveExtraDirs(
  ctx: ExecutionContext,
  requested: readonly string[],
): Promise<{ dirs: string[]; unavailable: number }> {
  const usable = await Promise.all(requested.map((dir) => isUsableFolder(ctx, dir)));
  const dirs = requested.filter((_, i) => usable[i]);
  return { dirs, unavailable: requested.length - dirs.length };
}

export type { AgentPick };

/** Cria o registro da execução em `preparing`, com o próximo índice de faixa da tarefa. */
export function createExecutionRecord(ctx: ExecutionContext, task: Task, pick: AgentPick): Execution {
  return buildExecutionRecord(ctx, task, pick.agentId, pick.model ?? null, pick.permission ?? null);
}

/** Registro da execução de um comando de projeto: roda direto na pasta da tarefa, sem agente nem catálogo. */
export function createCommandExecutionRecord(
  ctx: ExecutionContext,
  task: Task,
  command: ExecutionCommand,
): Execution {
  return buildExecutionRecord(ctx, task, COMMAND_AGENT_ID, null, null, command);
}

function buildExecutionRecord(
  ctx: ExecutionContext,
  task: Task,
  agentId: string,
  model: string | null,
  permissionMode: string | null,
  command?: ExecutionCommand,
): Execution {
  const existing = ctx.model.executionsOf(task.id);
  const next = Math.max(task.nextBandIndex ?? 0, ...existing.map((e) => e.bandIndex + 1), 0);
  const id = newId();
  const exec: Execution = {
    id,
    taskId: task.id,
    agentId,
    bandIndex: next,
    model,
    permissionMode,
    branch: '',
    worktreePath: isDirect(task) ? task.repoPath : ctx.paths.worktree(task.repoId, id),
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
    ...(command ? { command } : {}),
  };
  ctx.model.mutate((s) => {
    s.executions.push(exec);
    const t = s.tasks.find((x) => x.id === task.id);
    if (t) t.nextBandIndex = next + 1;
  });
  return exec;
}

/**
 * Prepara uma execução: valida agente, modelo e modo; na execução direta, só confere a pasta. Em worktree,
 * escolhe branch livre, adquire o lease e cria o worktree no commit base. Em falha, desfaz só o que foi
 * criado para esta execução.
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
    // Comando de projeto: sem agente no catálogo, sempre direto na pasta da tarefa.
    if (exec.command) {
      await assertFolderExists(ctx, exec.worktreePath, task);
      ctx.update(exec.id, { status: 'starting' });
      return;
    }
    const def = await ctx.catalog.agent(exec.agentId);
    const model = resolveModel(def, exec.model);
    const permission = resolvePermission(def, exec.permissionMode);
    ctx.update(exec.id, { model, permissionMode: permission });

    if (isDirect(task)) {
      await assertFolderExists(ctx, exec.worktreePath, task);
      ctx.update(exec.id, { status: 'starting' });
      return;
    }

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
