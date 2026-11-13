import { isMelinnaError, MelinnaError } from '../errors';
import type { Cancel, Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { AutomationStore } from './automation-store';
import { nextRun } from './schedule';
import type { Automation, AutomationRun } from './types';

/** De quanto em quanto tempo o agendador confere se há algo a disparar. */
export const AUTOMATION_TICK_MS = 30_000;

export interface AutomationSchedulerDeps {
  store: Pick<AutomationStore, 'list' | 'get' | 'recordRun' | 'subscribe'>;
  clock: Clock;
  log: Logger;
  /** Abre a sessão da automação e devolve a tarefa criada; rejeita se não foi possível lançar. */
  launch: (automation: Automation) => Promise<{ taskId: string }>;
}

function scheduleKey(a: Automation): string {
  return `${a.enabled ? 1 : 0}|${JSON.stringify(a.schedule)}`;
}

/**
 * Dispara as automações no horário, enquanto o app está aberto. Ao iniciar, um horário que passou com o
 * app fechado é registrado como perdido e não roda atrasado; o próximo disparo conta a partir de agora.
 */
export class AutomationScheduler {
  /** Próximo disparo e a "assinatura" do agendamento que o gerou, por automação ligada. */
  private readonly due = new Map<string, { at: Date; key: string }>();
  private readonly running = new Set<string>();
  private cancelTick: Cancel | null = null;
  private unsubscribe: (() => void) | null = null;
  private started = false;

  constructor(private readonly deps: AutomationSchedulerDeps) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const now = this.deps.clock.now();
    for (const a of this.deps.store.list()) {
      if (!a.enabled) continue;
      const since = new Date(a.lastRun?.at ?? a.createdAt);
      const expected = Number.isNaN(since.getTime()) ? null : nextRun(a.schedule, since);
      if (expected) await this.recordMissed(a, expected, now);
    }
    this.sync();
    this.unsubscribe = this.deps.store.subscribe(() => this.sync());
    this.arm();
  }

  stop(): void {
    this.started = false;
    this.cancelTick?.();
    this.cancelTick = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.due.clear();
  }

  /** Próximo disparo de uma automação ligada, para a interface; `null` se desligada ou desconhecida. */
  nextRunAt(id: string): string | null {
    return this.due.get(id)?.at.toISOString() ?? null;
  }

  /** Dispara agora, fora do horário; não muda o próximo disparo agendado. */
  async runNow(id: string): Promise<AutomationRun> {
    const automation = this.deps.store.get(id);
    if (!automation) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Automação não encontrada.' });
    return this.fire(automation);
  }

  /** Recalcula o próximo disparo só de quem é novo ou mudou de agendamento; esquece os removidos. */
  private sync(): void {
    const now = this.deps.clock.now();
    const seen = new Set<string>();
    for (const a of this.deps.store.list()) {
      if (!a.enabled) continue;
      seen.add(a.id);
      const key = scheduleKey(a);
      if (this.due.get(a.id)?.key !== key) this.due.set(a.id, { at: nextRun(a.schedule, now), key });
    }
    for (const id of this.due.keys()) if (!seen.has(id)) this.due.delete(id);
  }

  private arm(): void {
    if (!this.started) return;
    this.cancelTick = this.deps.clock.setTimeout(() => {
      void this.tick().finally(() => this.arm());
    }, AUTOMATION_TICK_MS);
  }

  private async tick(): Promise<void> {
    const now = this.deps.clock.now();
    for (const [id, entry] of [...this.due]) {
      if (entry.at.getTime() > now.getTime()) continue;
      const automation = this.deps.store.get(id);
      if (!automation || !automation.enabled) {
        this.due.delete(id);
        continue;
      }
      this.due.set(id, { at: nextRun(automation.schedule, now), key: entry.key });
      if (!this.started) return;
      if (now.getTime() - entry.at.getTime() >= AUTOMATION_TICK_MS) {
        await this.recordMissed(automation, entry.at, now);
      } else {
        await this.fire(automation);
      }
    }
  }

  private async recordMissed(automation: Automation, first: Date, now: Date): Promise<void> {
    for (let at = first; at.getTime() <= now.getTime(); at = nextRun(automation.schedule, at)) {
      await this.record(automation.id, { at: now.toISOString(), status: 'missed', detail: at.toISOString() });
    }
  }

  private async fire(automation: Automation): Promise<AutomationRun> {
    const { clock, log, launch } = this.deps;
    const at = clock.now().toISOString();
    if (this.running.has(automation.id)) {
      const run: AutomationRun = {
        at,
        status: 'failed',
        detail: 'O disparo anterior ainda está abrindo a sessão.',
      };
      await this.record(automation.id, run);
      return run;
    }
    this.running.add(automation.id);
    let run: AutomationRun;
    try {
      const { taskId } = await launch(automation);
      run = { at, status: 'launched', taskId };
      log.info('automations.launched', { automationId: automation.id, taskId });
    } catch (err) {
      const detail = isMelinnaError(err) ? err.userMessage : 'Erro interno ao abrir a sessão.';
      run = { at, status: 'failed', detail };
      log.error('automations.launch_failed', { err, automationId: automation.id });
    } finally {
      this.running.delete(automation.id);
    }
    await this.record(automation.id, run);
    return run;
  }

  private async record(id: string, run: AutomationRun): Promise<void> {
    try {
      await this.deps.store.recordRun(id, run);
    } catch (err) {
      this.deps.log.error('automations.record_failed', { err, automationId: id });
    }
  }
}
