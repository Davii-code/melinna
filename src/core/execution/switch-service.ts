import type { SwitchKind, SwitchPlan, TermSize } from '../api-types';
import { fillTemplate } from '../catalog/placeholders';
import { isMelinnaError, MelinnaError } from '../errors';
import { newId } from '../ids';
import type { Execution } from '../persistence/state-schema';
import type { ExecutionContext } from './context';
import { relaunchSeparator, STOP_GRACE_MS } from './lifecycle';
import { startExecution } from './start';
import { isLive } from './state-machine';
import { planSwitch, strategyOf, type SwitchRequest } from './switch-planner';

const DEFAULT_SIZE: TermSize = { cols: 100, rows: 30 };
const encoder = new TextEncoder();

interface StoredPlan {
  execId: string;
  req: SwitchRequest;
  plan: SwitchPlan;
}

/**
 * Aplica trocas de modelo e de modo de permissão conforme o catálogo. Troca por comando com o agente
 * ocupado fica pendente (`pendingSwitch`) até 1,5 s sem saída e pode ser cancelada; trocas por
 * relançamento encerram o processo e o relançam no mesmo worktree.
 */
export class SwitchService {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly pending = new Map<string, symbol>();
  private readonly sizes = new Map<string, TermSize>();

  constructor(private readonly ctx: ExecutionContext) {}

  /** Último tamanho de terminal conhecido, usado nos relançamentos. */
  rememberSize(execId: string, size: TermSize): void {
    this.sizes.set(execId, size);
  }

  async request(execId: string, kind: SwitchKind, value: string): Promise<SwitchPlan> {
    const exec = this.require(execId);
    const def = await this.ctx.catalog.agent(exec.agentId);
    const plan = planSwitch(def, exec, { kind, value }, this.ctx.busy.isBusy(execId), newId());
    for (const [id, p] of this.plans) if (p.execId === execId) this.plans.delete(id);
    this.plans.set(plan.planId, { execId, req: { kind, value }, plan });
    return plan;
  }

  async confirm(execId: string, planId: string): Promise<void> {
    const stored = this.plans.get(planId);
    if (!stored || stored.execId !== execId) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Plano de troca não encontrado ou expirado.' });
    }
    this.plans.delete(planId);
    const exec = this.require(execId);
    if (exec.status !== 'running' && exec.status !== 'idle') throw new MelinnaError('EXECUTION_NOT_RUNNING');
    const { req, plan } = stored;
    this.ctx.log.info('switch.confirmed', { execId, kind: req.kind, strategy: plan.kind });
    if (plan.kind === 'pty-command') {
      if (!this.ctx.busy.isBusy(execId)) {
        await this.applyCommand(execId, req);
        return;
      }
      const token = Symbol(execId);
      this.pending.set(execId, token);
      this.ctx.update(execId, { pendingSwitch: { kind: req.kind, value: req.value } });
      void this.ctx.busy.whenIdle(execId).then(() => this.applyPending(execId, token, req));
      return;
    }
    await this.restart(exec, req, plan.kind === 'restart-resume');
  }

  /** Cancela uma troca pendente; nada é escrito no PTY. */
  cancelPending(execId: string): void {
    this.pending.delete(execId);
    if (this.ctx.model.execution(execId)?.pendingSwitch) this.ctx.update(execId, { pendingSwitch: null });
  }

  /** Na abertura do app: rearma as trocas pendentes de execuções vivas e limpa as das encerradas. */
  resumePending(): void {
    for (const exec of this.ctx.model.raw.executions) {
      const p = exec.pendingSwitch;
      if (!p) continue;
      if (!isLive(exec.status)) {
        this.ctx.update(exec.id, { pendingSwitch: null });
        continue;
      }
      const token = Symbol(exec.id);
      this.pending.set(exec.id, token);
      void this.ctx.busy.whenIdle(exec.id).then(() => this.applyPending(exec.id, token, p));
    }
  }

  private async applyPending(execId: string, token: symbol, req: SwitchRequest): Promise<void> {
    if (this.pending.get(execId) !== token) return;
    this.pending.delete(execId);
    const exec = this.ctx.model.execution(execId);
    if (!exec || (exec.status !== 'running' && exec.status !== 'idle')) {
      if (exec?.pendingSwitch) this.ctx.update(execId, { pendingSwitch: null });
      return;
    }
    await this.applyCommand(execId, req).catch((err: unknown) => {
      this.ctx.update(execId, { pendingSwitch: null });
      this.ctx.log.warn('switch.pending_failed', { execId, code: isMelinnaError(err) ? err.code : 'INTERNAL' });
    });
  }

  private async applyCommand(execId: string, req: SwitchRequest): Promise<void> {
    const exec = this.require(execId);
    const def = await this.ctx.catalog.agent(exec.agentId);
    const strategy = strategyOf(def, req.kind);
    if (!strategy || strategy.strategy !== 'pty-command') throw new MelinnaError('SWITCH_UNSUPPORTED');
    const host = await this.ctx.hosts.existing();
    if (!host) throw new MelinnaError('HOST_UNAVAILABLE');
    const text = fillTemplate(strategy.template, req.kind === 'model' ? { '{model}': req.value } : { '{permission}': req.value });
    host.write(execId, encoder.encode(text));
    this.ctx.update(execId, {
      ...(req.kind === 'model' ? { model: req.value } : { permissionMode: req.value }),
      pendingSwitch: null,
    });
    this.ctx.log.info('switch.applied', { execId, kind: req.kind, strategy: 'pty-command' });
  }

  private async restart(exec: Execution, req: SwitchRequest, resume: boolean): Promise<void> {
    const host = await this.ctx.hosts.existing();
    if (!host) throw new MelinnaError('HOST_UNAVAILABLE');
    this.cancelPending(exec.id);
    try {
      await host.kill(exec.id, { graceMs: STOP_GRACE_MS });
    } catch (err) {
      if (!isMelinnaError(err) || err.code !== 'EXECUTION_NOT_RUNNING') throw err;
    }
    this.ctx.busy.ended(exec.id);
    this.ctx.update(exec.id, {
      ...(req.kind === 'model' ? { model: req.value } : { permissionMode: req.value }),
      status: 'starting',
      pid: null,
    });
    const current = this.require(exec.id);
    await startExecution(this.ctx, current, this.sizes.get(exec.id) ?? DEFAULT_SIZE, {
      resume,
      separator: relaunchSeparator(this.ctx.clock.now()),
    });
    this.ctx.log.info('switch.applied', {
      execId: exec.id,
      kind: req.kind,
      strategy: resume ? 'restart-resume' : 'restart-fresh',
    });
  }

  private require(execId: string): Execution {
    const exec = this.ctx.model.execution(execId);
    if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    return exec;
  }
}
