import { MelinnaError, toIpcError } from '../errors';
import type { Execution } from '../persistence/state-schema';
import type { ExecutionContext, TermSize } from './context';
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

/** Inicia o processo da execução no hospedeiro, a partir do worktree já preparado. */
export async function startExecution(
  ctx: ExecutionContext,
  exec: Execution,
  size: TermSize,
  opts: StartOptions,
): Promise<void> {
  try {
    const plan = await ctx.catalog.buildLaunch({
      agentId: exec.agentId,
      model: exec.model,
      permission: exec.permissionMode,
      prompt: opts.prompt ?? '',
      resume: opts.resume ?? false,
    });
    const host = await ctx.hosts.get();
    const { cols, rows } = clampSize(size);
    const req = {
      execId: exec.id,
      file: plan.file,
      args: plan.args,
      cwd: exec.worktreePath,
      env: { ...ctx.baseEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', MELINNA_EXECUTION_ID: exec.id },
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
    });
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
