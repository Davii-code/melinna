import type { LaunchResult, RemovalCheck, SwitchKind, SwitchPlan } from '../api-types';
import { MelinnaError, toIpcError } from '../errors';
import { baseAdvancedBy } from '../git/divergence';
import { isDirect, type Execution } from '../persistence/state-schema';
import type { Detach, ExitEvent, HostClient, OutputSink } from '../ports/host-client';
import { BusyTracker } from './busy-tracker';
import type { ExecutionContext, ExecutionDeps, TermSize } from './context';
import { checkRemoval, relaunchExecution, removeExecution, removeTask, stopExecution } from './lifecycle';
import { assertWithinLimit } from './limits';
import { createExecutionRecord, prepareExecution, type AgentPick } from './prepare';
import { markLiveAsLost, reconcileWithHost } from './recovery';
import { clampSize, startExecution } from './start';
import { isEnded, isLive } from './state-machine';
import { SwitchService } from './switch-service';

export type { LaunchResult };

export type EndedReason = 'ended' | 'removed';

/** Fachada das execuções: lançamento, E/S do terminal e reação aos eventos do hospedeiro. */
export class ExecutionService {
  private readonly ctx: ExecutionContext;
  private wiredHost: HostClient | null = null;
  private readonly unwire: (() => void)[] = [];
  private readonly exitListeners = new Set<(e: ExitEvent) => void>();
  private readonly busyListeners = new Set<(execId: string) => void>();
  private readonly idleListeners = new Set<(execId: string) => void>();
  private readonly endedListeners = new Set<(execId: string, reason: EndedReason) => void>();
  private readonly switches: SwitchService;

  constructor(deps: ExecutionDeps) {
    const busy = new BusyTracker(deps.clock, (execId, isBusy) => this.onBusyChange(execId, isBusy));
    deps.model.setBusySource(() => busy.busyIds());
    this.ctx = {
      ...deps,
      busy,
      update: (execId, patch) => {
        const before = deps.model.execution(execId)?.status;
        if (before === undefined) return;
        deps.model.mutate((s) => {
          const e = s.executions.find((x) => x.id === execId);
          if (e) Object.assign(e, patch);
        });
        if (patch.status !== undefined && isLive(before) && isEnded(patch.status)) {
          this.notify(this.endedListeners, execId, 'ended');
        }
      },
      removed: (execId) => this.notify(this.endedListeners, execId, 'removed'),
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

  /** A execução ficou ocupada (houve saída), depois de o estado ser atualizado. */
  onBusy(fn: (execId: string) => void): () => void {
    this.busyListeners.add(fn);
    return () => this.busyListeners.delete(fn);
  }

  /** A execução voltou a ficar ociosa depois de ocupada, depois de o estado ser atualizado. */
  onIdle(fn: (execId: string) => void): () => void {
    this.idleListeners.add(fn);
    return () => this.idleListeners.delete(fn);
  }

  /** A execução terminou (saída, perda do hospedeiro) ou o registro dela foi removido. */
  onEnded(fn: (execId: string, reason: EndedReason) => void): () => void {
    this.endedListeners.add(fn);
    return () => this.endedListeners.delete(fn);
  }

  liveCount(): number {
    return this.ctx.model.liveCount();
  }

  isBusy(execId: string): boolean {
    return this.ctx.busy.isBusy(execId);
  }

  /**
   * Lança uma execução por agente. Os worktrees são preparados em série; cada processo inicia assim que o seu
   * worktree fica pronto. Falhas são isoladas por execução. Cada processo recebe o enunciado da tarefa,
   * exceto com `withPrompt: false` (terminal a mais numa sessão que já existe).
   */
  async launch(
    taskId: string,
    picks: AgentPick[],
    size: TermSize,
    opts: { withPrompt?: boolean } = {},
  ): Promise<LaunchResult[]> {
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
        startExecution(
          this.ctx,
          current,
          size,
          opts.withPrompt === false ? {} : { prompt: task.prompt },
        ).then(
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

  /**
   * Relança no mesmo worktree, com separador no histórico. Usa o tamanho que o painel informou por
   * último: o agente desenha a primeira tela na largura do PTY, e lançar com um tamanho padrão diferente
   * do painel deixa essa tela embaralhada (o redesenho após o resize não refaz o que já foi impresso).
   * `size` vale só quando o painel nunca informou o tamanho.
   */
  relaunch(execId: string, size: TermSize): Promise<void> {
    return relaunchExecution(this.ctx, execId, this.switches.sizeOf(execId) ?? size);
  }

  removalCheck(execId: string): Promise<RemovalCheck> {
    return checkRemoval(this.ctx, execId);
  }

  /** Remove uma execução encerrada; sem `force`, recusa perder trabalho (WORK_WOULD_BE_LOST). */
  remove(execId: string, opts: { deleteBranch: boolean; force: boolean }): Promise<void> {
    return removeExecution(this.ctx, execId, opts);
  }

  /** Remove uma sessão e as execuções dela; recusa com execução viva. */
  removeTask(taskId: string): Promise<void> {
    return removeTask(this.ctx, taskId);
  }

  /** Remove todas as sessões do grupo; confere antes que nenhuma execução do grupo está viva. */
  async removeTasksOf(groupId: string): Promise<void> {
    const tasks = this.ctx.model.raw.tasks.filter((t) => t.groupId === groupId);
    const liveExecs = tasks.flatMap((t) => this.ctx.model.executionsOf(t.id)).filter((e) => isLive(e.status));
    if (liveExecs.length > 0) {
      throw new MelinnaError('EXECUTION_RUNNING', {
        userMessage: liveExecs.some((e) => e.command)
          ? 'Pare o comando antes.'
          : 'Pare as sessões do workspace antes de removê-lo.',
      });
    }
    for (const t of tasks) await removeTask(this.ctx, t.id);
  }

  /** Commits que a base da tarefa avançou desde a criação do worktree. */
  async divergence(execId: string): Promise<{ baseAdvancedBy: number }> {
    const exec = this.ctx.model.execution(execId);
    const task = exec ? this.ctx.model.task(exec.taskId) : undefined;
    if (!exec || !task) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    // Execução direta roda na própria pasta: não há base fixa da qual divergir.
    if (isDirect(task)) return { baseAdvancedBy: 0 };
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
    this.notify(isBusy ? this.busyListeners : this.idleListeners, execId);
  }

  /** Chama os ouvintes; um ouvinte que falha não impede os demais nem o fluxo do serviço. */
  private notify<A extends unknown[]>(
    listeners: ReadonlySet<(execId: string, ...args: A) => void>,
    execId: string,
    ...args: A
  ): void {
    for (const fn of listeners) {
      try {
        fn(execId, ...args);
      } catch (err) {
        this.ctx.log.error('execution.listener_failed', { err, execId });
      }
    }
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
