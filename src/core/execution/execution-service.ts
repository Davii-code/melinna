import type { LaunchResult, RemovalCheck, SwitchKind, SwitchPlan } from '../api-types';
import { MelinnaError, toIpcError } from '../errors';
import { baseAdvancedBy } from '../git/divergence';
import type { Execution } from '../persistence/state-schema';
import type { Detach, ExitEvent, HostClient, OutputSink } from '../ports/host-client';
import { BusyTracker } from './busy-tracker';
import type { ExecutionContext, ExecutionDeps, TermSize } from './context';
import { checkRemoval, relaunchExecution, removeExecution, stopExecution } from './lifecycle';
import { assertWithinLimit } from './limits';
import { createExecutionRecord, prepareExecution, type AgentPick } from './prepare';
import { markLiveAsLost, reconcileWithHost } from './recovery';
import { clampSize, startExecution } from './start';
import { isLive } from './state-machine';
import { SwitchService } from './switch-service';

export type { LaunchResult };

/** Fachada das execuções: lançamento, E/S do terminal e reação aos eventos do hospedeiro. */
export class ExecutionService {
  private readonly ctx: ExecutionContext;
  private wiredHost: HostClient | null = null;
  private readonly unwire: (() => void)[] = [];
  private readonly exitListeners = new Set<(e: ExitEvent) => void>();
  private readonly switches: SwitchService;

  constructor(deps: ExecutionDeps) {
    const busy = new BusyTracker(deps.clock, (execId, isBusy) => this.onBusyChange(execId, isBusy));
    deps.model.setBusySource(() => busy.busyIds());
    this.ctx = {
      ...deps,
      busy,
      update: (execId, patch) => {
        if (!deps.model.execution(execId)) return;
        deps.model.mutate((s) => {
          const e = s.executions.find((x) => x.id === execId);
          if (e) Object.assign(e, patch);
        });
      },
      hosts: {
        get: async () => this.wire(await deps.hosts.get()),
        existing: async () => {
          const h = await deps.hosts.existing();
          return h ? this.wire(h) : null;
        },
      },
    };
    this.switches = new SwitchService(this.ctx);
  }

  /** Contexto interno, para os módulos de ciclo de vida e troca. */
  context(): ExecutionContext {
    return this.ctx;
  }

  /** Término de processo, depois de o estado ser atualizado. */
  onExit(fn: (e: ExitEvent) => void): () => void {
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  liveCount(): number {
    return this.ctx.model.liveCount();
  }

  isBusy(execId: string): boolean {
    return this.ctx.busy.isBusy(execId);
  }

  /**
   * Lança uma execução por agente. Os worktrees são preparados em série; cada processo inicia assim que o seu
   * worktree fica pronto. Falhas são isoladas por execução.
   */
  async launch(taskId: string, picks: AgentPick[], size: TermSize): Promise<LaunchResult[]> {
    const task = this.ctx.model.task(taskId);
    if (!task) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Tarefa não encontrada.' });
    if (picks.length === 0)
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Escolha ao menos um agente.' });
    assertWithinLimit(this.liveCount(), picks.length);
    const records = picks.map((p) => createExecutionRecord(this.ctx, task, p));
    const reserved = new Set<string>();
    const results: Promise<LaunchResult>[] = [];
    for (const exec of records) {
      try {
        await prepareExecution(this.ctx, task, exec, reserved);
      } catch (err) {
        results.push(
          Promise.resolve({ execId: exec.id, agentId: exec.agentId, ok: false, error: toIpcError(err) }),
        );
        continue;
      }
      const current = this.ctx.model.execution(exec.id) ?? exec;
      results.push(
        startExecution(this.ctx, current, size, { prompt: task.prompt }).then(
          (): LaunchResult => ({ execId: exec.id, agentId: exec.agentId, ok: true }),
          (err: unknown): LaunchResult => ({
            execId: exec.id,
            agentId: exec.agentId,
            ok: false,
            error: toIpcError(err),
          }),
        ),
      );
    }
    return Promise.all(results);
  }

  write(execId: string, data: Uint8Array): void {
    const exec = this.requireLive(execId);
    this.wiredHost?.write(exec.id, data);
  }

  resize(execId: string, size: TermSize): void {
    this.switches.rememberSize(execId, size);
    const exec = this.ctx.model.execution(execId);
    if (!exec || !isLive(exec.status) || !this.wiredHost) return;
    const { cols, rows } = clampSize(size);
    this.wiredHost.resize(execId, cols, rows);
  }

  ack(execId: string, offset: number): void {
    this.wiredHost?.ack(execId, offset);
  }

  /** Anexa um consumidor à saída: reproduz o histórico inteiro e emenda a saída ao vivo. */
  async attach(execId: string, sink: OutputSink): Promise<Detach> {
    if (!this.ctx.model.execution(execId))
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    const host = (await this.ctx.hosts.existing()) ?? (await this.ctx.hosts.get());
    return host.attach(execId, 0, sink);
  }

  /** Planeja a troca de modelo ou de modo; nada muda até `confirmSwitch`. */
  requestSwitch(execId: string, kind: SwitchKind, value: string): Promise<SwitchPlan> {
    return this.switches.request(execId, kind, value);
  }

  confirmSwitch(execId: string, planId: string): Promise<void> {
    return this.switches.confirm(execId, planId);
  }

  cancelPendingSwitch(execId: string): void {
    this.switches.cancelPending(execId);
  }

  /** Na abertura: rearma as trocas que estavam pendentes. */
  resumePendingSwitches(): void {
    this.switches.resumePending();
  }

  /** Para o processo; worktree e lease ficam. */
  stop(execId: string): Promise<void> {
    return stopExecution(this.ctx, execId);
  }

  /** Relança no mesmo worktree, com separador no histórico. */
  relaunch(execId: string, size: TermSize): Promise<void> {
    return relaunchExecution(this.ctx, execId, size);
  }

  removalCheck(execId: string): Promise<RemovalCheck> {
    return checkRemoval(this.ctx, execId);
  }

  /** Remove uma execução encerrada; sem `force`, recusa perder trabalho (WORK_WOULD_BE_LOST). */
  remove(execId: string, opts: { deleteBranch: boolean; force: boolean }): Promise<void> {
    return removeExecution(this.ctx, execId, opts);
  }

  /** Commits que a base da tarefa avançou desde a criação do worktree. */
  async divergence(execId: string): Promise<{ baseAdvancedBy: number }> {
    const exec = this.ctx.model.execution(execId);
    const task = exec ? this.ctx.model.task(exec.taskId) : undefined;
    if (!exec || !task) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    const n = await baseAdvancedBy(
      { git: this.ctx.git, log: this.ctx.log },
      { repoRoot: task.repoPath, baseRef: task.baseRef, baseCommit: exec.baseCommit },
    );
    return { baseAdvancedBy: n };
  }

  async reconcileWithHost(): Promise<void> {
    await reconcileWithHost(this.ctx, await this.ctx.hosts.existing().catch(() => null));
  }

  /** Encerra todas as execuções vivas (gracioso e, após `graceMs`, forçado). */
  async stopAll(graceMs: number): Promise<void> {
    const host = this.wiredHost;
    if (!host) return;
    const live = this.ctx.model.raw.executions.filter((e) => isLive(e.status));
    await Promise.all(live.map((e) => host.kill(e.id, { graceMs }).catch(() => undefined)));
  }

  private requireLive(execId: string): Execution {
    const exec = this.ctx.model.execution(execId);
    if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    if (!isLive(exec.status)) throw new MelinnaError('EXECUTION_NOT_RUNNING');
    return exec;
  }

  private onBusyChange(execId: string, isBusy: boolean): void {
    const exec = this.ctx.model.execution(execId);
    if (!exec) return;
    if (isBusy && exec.status === 'idle') this.ctx.update(execId, { status: 'running' });
    else if (!isBusy && exec.status === 'running') this.ctx.update(execId, { status: 'idle' });
    else this.ctx.model.touch();
  }

  /** Liga os eventos de um cliente do hospedeiro (uma vez por cliente). */
  private wire(host: HostClient): HostClient {
    if (this.wiredHost === host) return host;
    for (const off of this.unwire.splice(0)) off();
    this.wiredHost = host;
    this.unwire.push(
      host.on('exit', (e) => {
        const exec = this.ctx.model.execution(e.execId);
        if (!exec || !isLive(exec.status)) return;
        this.ctx.busy.ended(e.execId);
        this.ctx.update(e.execId, {
          status: 'exited',
          exitCode: e.exitCode,
          signal: e.signal,
          endedAt: e.endedAt,
          pid: null,
        });
        this.ctx.log.info('execution.exited', { execId: e.execId, code: e.exitCode, signal: e.signal });
        for (const fn of this.exitListeners) fn(e);
      }),
      host.on('activity', (e) => {
        const exec = this.ctx.model.execution(e.execId);
        if (exec && (exec.status === 'running' || exec.status === 'idle'))
          this.ctx.busy.activity(e.execId, new Date(e.lastOutputAt));
      }),
      host.on('scrollback-status', (e) =>
        this.ctx.model.setScrollbackPaused(e.execId, e.persisting ? null : (e.reason ?? 'IO_ERROR')),
      ),
      host.on('disconnected', () => {
        if (this.wiredHost !== host) return;
        this.wiredHost = null;
        this.ctx.log.warn('host.disconnected');
        markLiveAsLost(this.ctx);
      }),
    );
    return host;
  }
}
