import { MelinnaError, toIpcError } from '../errors';
import type { Execution, ExecutionNotice } from '../persistence/state-schema';
import type { ExecutionCommand } from '../run/types';
import type { ExecutionContext, TermSize } from './context';
import { resolveExtraDirs } from './prepare';
import { deliverPromptAfterFirstOutput } from './prompt-delivery';

export interface StartOptions {
  resume?: boolean;
  separator?: string;
  /** Enunciado: só no primeiro lançamento. */
  prompt?: string;
}

export function clampSize(size: TermSize): TermSize {
  return {
    cols: Math.min(1000, Math.max(20, Math.round(size.cols))),
    rows: Math.min(500, Math.max(5, Math.round(size.rows))),
  };
}

function terminalEnv(ctx: ExecutionContext, execId: string): Record<string, string> {
  return { ...ctx.baseEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', MELINNA_EXECUTION_ID: execId };
}

/**
 * Lança um comando de projeto: programa e argumentos já resolvidos ficam na execução, sem catálogo, sem
 * enunciado e sem pastas extras. Roda na pasta da tarefa e vai ao hospedeiro como qualquer sessão.
 */
async function spawnCommand(
  ctx: ExecutionContext,
  exec: Execution,
  command: ExecutionCommand,
  size: TermSize,
  opts: StartOptions,
): Promise<void> {
  const host = await ctx.hosts.get();
  const { cols, rows } = clampSize(size);
  const { pid } = await host.spawn({
    execId: exec.id,
    file: command.file,
    args: command.args,
    cwd: exec.worktreePath,
    env: terminalEnv(ctx, exec.id),
    cols,
    rows,
    ...(opts.separator ? { separator: opts.separator } : {}),
  });
  ctx.update(exec.id, {
    status: 'running',
    pid,
    startedAt: ctx.clock.now().toISOString(),
    endedAt: null,
    exitCode: null,
    signal: null,
    failure: null,
    launchCount: exec.launchCount + 1,
  });
  ctx.busy.activity(exec.id);
  ctx.log.info('execution.launched', { execId: exec.id, command: true });
}

/** Inicia o processo da execução no hospedeiro, a partir do worktree já preparado. */
export async function startExecution(
  ctx: ExecutionContext,
  exec: Execution,
  size: TermSize,
  opts: StartOptions,
): Promise<void> {
  try {
    if (exec.command) {
      await spawnCommand(ctx, exec, exec.command, size, opts);
      return;
    }
    // As pastas extras são as da tarefa (guardadas na criação); as que sumiram desde então ficam de fora.
    const requested = ctx.model.task(exec.taskId)?.extraDirs ?? [];
    const { dirs, unavailable } = await resolveExtraDirs(ctx, requested);
    const plan = await ctx.catalog.buildLaunch({
      agentId: exec.agentId,
      model: exec.model,
      permission: exec.permissionMode,
      prompt: opts.prompt ?? '',
      resume: opts.resume ?? false,
      extraDirs: dirs,
    });
    const omitted = unavailable + plan.extraDirsOmitted;
    const notices: ExecutionNotice[] = [];
    if (requested.length > 0 && !plan.agent.extraDirs) notices.push({ kind: 'extra-dirs-unsupported' });
    else if (omitted > 0) notices.push({ kind: 'extra-dirs-omitted', count: omitted });
    const host = await ctx.hosts.get();
    const { cols, rows } = clampSize(size);
    const req = {
      execId: exec.id,
      file: plan.file,
      args: plan.args,
      cwd: exec.worktreePath,
      env: terminalEnv(ctx, exec.id),
      cols,
      rows,
      ...(opts.separator ? { separator: opts.separator } : {}),
    };
    const delivery = plan.promptViaPty
      ? deliverPromptAfterFirstOutput(host, exec.id, plan.promptViaPty)
      : null;
    let pid: number;
    try {
      ({ pid } = await host.spawn(req));
    } catch (err) {
      delivery?.cancel();
      throw err;
    }
    ctx.update(exec.id, {
      status: 'running',
      pid,
      startedAt: ctx.clock.now().toISOString(),
      endedAt: null,
      exitCode: null,
      signal: null,
      failure: null,
      launchCount: exec.launchCount + 1,
      ...(notices.length > 0 || exec.notices ? { notices } : {}),
    });
    if (requested.length > 0) {
      const applied = plan.extraDirsApplied ? dirs.length - plan.extraDirsOmitted : 0;
      ctx.log.info('execution.extra_dirs', { execId: exec.id, applied, omitted: requested.length - applied });
    }
    ctx.busy.activity(exec.id);
    ctx.log.info('execution.launched', {
      execId: exec.id,
      agentId: exec.agentId,
      model: plan.model,
      permission: plan.permission,
      promptViaPty: plan.promptViaPty !== undefined,
    });
  } catch (err) {
    const e = toIpcError(err);
    ctx.update(exec.id, {
      status: 'failed_to_start',
      failure: { code: e.code, message: e.message },
      pid: null,
    });
    ctx.log.warn('execution.start_failed', { execId: exec.id, agentId: exec.agentId, code: e.code });
    if (!(err instanceof MelinnaError)) ctx.log.error('execution.start_internal', { execId: exec.id, err });
    throw err;
  }
}
