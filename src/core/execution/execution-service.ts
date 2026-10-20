import { MelinnaError, toIpcError, type IpcError } from '../errors';
import type { Execution } from '../persistence/state-schema';
import type { Detach, HostClient, OutputSink } from '../ports/host-client';
import { BusyTracker } from './busy-tracker';
import type { ExecutionContext, ExecutionDeps, TermSize } from './context';
import { assertWithinLimit } from './limits';
import { createExecutionRecord, prepareExecution, type AgentPick } from './prepare';
import { markLiveAsLost, reconcileWithHost } from './recovery';
import { clampSize, startExecution } from './start';
import { isLive } from './state-machine';

export type LaunchResult =
  | { execId: string; agentId: string; ok: true }
  | { execId?: string; agentId: string; ok: false; error: IpcError };

/** Fachada das execuções: lançamento, E/S do terminal e reação aos eventos do hospedeiro. */
export class ExecutionService {
  private readonly ctx: ExecutionContext;
  private wiredHost: HostClient | null = null;
  private readonly unwire: (() => void)[] = [];

  constructor(deps: ExecutionDeps) {
    const busy = new BusyTracker(deps.clock, (execId, isBusy) => this.onBusyChange(execId, isBusy));
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
  }

  /** Contexto interno, para os módulos de ciclo de vida e troca. */
  context(): ExecutionContext {
    return this.ctx;
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
    if (!isBusy && exec.status === 'running') this.ctx.update(execId, { status: 'idle' });
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
      }),
      host.on('activity', (e) => {
        const exec = this.ctx.model.execution(e.execId);
        if (exec && (exec.status === 'running' || exec.status === 'idle'))
          this.ctx.busy.activity(e.execId, new Date(e.lastOutputAt));
      }),
      host.on('scrollback-status', (e) => this.ctx.model.setScrollbackPaused(e.execId, !e.persisting)),
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
