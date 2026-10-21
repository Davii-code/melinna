import type { RemovalCheck } from '../api-types';
import { isMelinnaError, MelinnaError } from '../errors';
import { acquireLease } from '../git/lease';
import { removalCheck, removeExecutionArtifacts, type RemovalDeps, type RemovalTarget } from '../git/removal';
import { isDirect, type Execution, type Pane, type Task } from '../persistence/state-schema';
import type { ExecutionContext, TermSize } from './context';
import { assertWithinLimit } from './limits';
import { assertFolderExists, prepareExecution } from './prepare';
import { startExecution } from './start';
import { isLive, transition } from './state-machine';

export const STOP_GRACE_MS = 5000;

function requireExecution(ctx: ExecutionContext, execId: string): Execution {
  const exec = ctx.model.execution(execId);
  if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
  return exec;
}

function requireTask(ctx: ExecutionContext, exec: Execution): Task {
  const task = ctx.model.task(exec.taskId);
  if (!task) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Tarefa da execução não encontrada.' });
  return task;
}

function removalDeps(ctx: ExecutionContext): RemovalDeps {
  return { git: ctx.git, fs: ctx.fs, mutex: ctx.mutex, log: ctx.log, os: ctx.os };
}

function removalTarget(ctx: ExecutionContext, exec: Execution, task: Task): RemovalTarget {
  return {
    repoRoot: task.repoPath,
    repoId: task.repoId,
    worktreePath: exec.worktreePath,
    branch: exec.branch,
    baseRef: task.baseRef,
    baseCommit: exec.baseCommit,
    leasePath: ctx.paths.lease(task.repoId, exec.id),
  };
}

/** Texto gravado no histórico antes de um relançamento: reset de atributos, data e hora. */
export function relaunchSeparator(at: Date): string {
  const when = at.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });
  return `\r\n\x1b[0m\x1b[2m── relançado em ${when} ──\x1b[0m\r\n`;
}

/** Para o processo (Ctrl+C e, após o prazo, encerramento forçado da árvore). Worktree e lease ficam. */
export async function stopExecution(
  ctx: ExecutionContext,
  execId: string,
  graceMs = STOP_GRACE_MS,
): Promise<void> {
  const exec = requireExecution(ctx, execId);
  if (!isLive(exec.status) || exec.status === 'preparing') {
    throw new MelinnaError('EXECUTION_NOT_RUNNING', {
      userMessage:
        exec.status === 'preparing'
          ? 'A execução ainda está sendo preparada.'
          : 'A execução não está rodando.',
    });
  }
  const host = await ctx.hosts.existing();
  if (!host) {
    ctx.busy.ended(execId);
    ctx.update(execId, {
      status: 'lost',
      pid: null,
      failure: { code: 'HOST_UNAVAILABLE', message: 'O hospedeiro de terminais não está mais rodando.' },
    });
    return;
  }
  try {
    await host.kill(execId, { graceMs });
  } catch (err) {
    if (!isMelinnaError(err) || err.code !== 'EXECUTION_NOT_RUNNING') throw err;
    // o hospedeiro não conhece o processo: o término não foi registrado por este hospedeiro
    ctx.busy.ended(execId);
    ctx.update(execId, {
      status: 'lost',
      pid: null,
      failure: { code: 'HOST_UNAVAILABLE', message: 'O processo não está mais vivo.' },
    });
  }
  ctx.log.info('execution.stopped', { execId });
}

/**
 * Relança uma execução encerrada no mesmo worktree, com o mesmo agente, modelo e modo. Se o preparo
 * nunca terminou (sem branch ou sem worktree), prepara de novo. O histórico ganha um separador.
 */
export async function relaunchExecution(
  ctx: ExecutionContext,
  execId: string,
  size: TermSize,
): Promise<void> {
  const exec = requireExecution(ctx, execId);
  transition(exec.status, 'relaunch');
  assertWithinLimit(ctx.model.liveCount(), 1);
  const task = requireTask(ctx, exec);
  const prepared = exec.branch !== '' && (await ctx.fs.exists(exec.worktreePath));
  if (isDirect(task)) {
    await assertFolderExists(ctx, exec.worktreePath);
    ctx.update(exec.id, { status: 'starting', failure: null });
  } else if (prepared) {
    await acquireLease({
      fs: ctx.fs,
      os: ctx.os,
      leasePath: ctx.paths.lease(task.repoId, exec.id),
      lease: { execId: exec.id, worktreePath: exec.worktreePath, createdAt: ctx.clock.now().toISOString() },
      isKnownExecution: (id) => ctx.model.execution(id) !== undefined,
    });
    ctx.update(exec.id, { status: 'starting', failure: null });
  } else {
    ctx.update(exec.id, { status: 'preparing', failure: null });
    await prepareExecution(ctx, task, requireExecution(ctx, execId), new Set());
  }
  const current = requireExecution(ctx, execId);
  await startExecution(ctx, current, size, {
    separator: relaunchSeparator(ctx.clock.now()),
    ...(current.launchCount === 0 ? { prompt: task.prompt } : {}),
  });
  ctx.log.info('execution.relaunched', { execId, launchCount: current.launchCount + 1 });
}

/** Na execução direta não há worktree nem branch do app: remover não descarta trabalho. */
const NOTHING_TO_LOSE: RemovalCheck = { uncommittedFiles: 0, unmergedCommits: 0, branch: '' };

export async function checkRemoval(ctx: ExecutionContext, execId: string): Promise<RemovalCheck> {
  const exec = requireExecution(ctx, execId);
  const task = requireTask(ctx, exec);
  if (isDirect(task)) return NOTHING_TO_LOSE;
  return removalCheck(removalDeps(ctx), removalTarget(ctx, exec, task));
}

/**
 * Remove uma execução encerrada: worktree, branch (opcional), lease, histórico e registro.
 * Sem `force`, recusa com WORK_WOULD_BE_LOST se houver arquivos não commitados ou, apagando a branch,
 * commits fora da base. Na execução direta, a pasta é do usuário e nunca é apagada: saem só o histórico
 * do terminal e o registro.
 */
export async function removeExecution(
  ctx: ExecutionContext,
  execId: string,
  opts: { deleteBranch: boolean; force: boolean },
): Promise<void> {
  const exec = requireExecution(ctx, execId);
  if (isLive(exec.status)) {
    throw new MelinnaError('EXECUTION_RUNNING', { userMessage: 'Pare a execução antes de removê-la.' });
  }
  const task = requireTask(ctx, exec);
  let loses = false;
  if (!isDirect(task)) {
    const deps = removalDeps(ctx);
    const target = removalTarget(ctx, exec, task);
    const check = await removalCheck(deps, target);
    loses = check.uncommittedFiles > 0 || (opts.deleteBranch && check.unmergedCommits > 0);
    if (loses && !opts.force) {
      throw new MelinnaError('WORK_WOULD_BE_LOST', {
        userMessage: 'A remoção descartaria trabalho do agente. Confirme a remoção forçada para continuar.',
        details: {
          uncommittedFiles: check.uncommittedFiles,
          unmergedCommits: opts.deleteBranch ? check.unmergedCommits : 0,
        },
      });
    }
    await removeExecutionArtifacts(deps, target, opts);
  }
  await ctx.fs
    .rm(ctx.paths.scrollbackDir(exec.id), { recursive: true, force: true })
    .catch((err: unknown) => {
      ctx.log.error('scrollback.remove_failed', { execId, err });
    });
  ctx.busy.ended(exec.id);
  ctx.model.mutate((s) => {
    s.executions = s.executions.filter((e) => e.id !== exec.id);
    const l = s.layout;
    const panes: Pane[] = [];
    for (const pane of l.panes) {
      if (pane.kind !== 'executions') {
        panes.push(pane);
        continue;
      }
      const execIds = pane.execIds.filter((id) => id !== exec.id);
      if (execIds.length === 0) continue;
      panes.push({ ...pane, execIds, activeIndex: Math.min(pane.activeIndex, execIds.length - 1) });
    }
    l.panes = panes;
    if (l.focusedPaneId !== null && !panes.some((pane) => pane.id === l.focusedPaneId)) {
      l.focusedPaneId = panes[0]?.id ?? null;
    }
    const { [exec.id]: _removed, ...remainingCells } = l.custom.cells;
    l.custom.cells = remainingCells;
  });
  ctx.log.info('execution.removed', {
    execId,
    deletedBranch: opts.deleteBranch,
    forced: opts.force && loses,
  });
}

/**
 * Remove uma sessão (tarefa) e as execuções dela. Recusa se alguma estiver viva. Execuções em worktree
 * saem com remoção forçada (o worktree do app é apagado; a branch fica); a pasta do usuário nunca é tocada.
 */
export async function removeTask(ctx: ExecutionContext, taskId: string): Promise<void> {
  const task = ctx.model.task(taskId);
  if (!task) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Sessão não encontrada.' });
  const execs = ctx.model.executionsOf(taskId);
  if (execs.some((e) => isLive(e.status))) {
    throw new MelinnaError('EXECUTION_RUNNING', { userMessage: 'Pare a sessão antes de removê-la.' });
  }
  for (const exec of execs) await removeExecution(ctx, exec.id, { deleteBranch: false, force: true });
  ctx.model.mutate((s) => {
    s.tasks = s.tasks.filter((t) => t.id !== taskId);
  });
  ctx.log.info('task.removed', { taskId, executions: execs.length });
}
