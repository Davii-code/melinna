import type { Cancel, Clock } from '../ports/clock';

export const BUSY_QUIET_MS = 1500;

/** Ocupado = houve saída nos últimos 1,5 s. Execução encerrada nunca está ocupada. */
export class BusyTracker {
  private readonly timers = new Map<string, Cancel>();

  constructor(
    private readonly clock: Clock,
    private readonly onChange: (execId: string, busy: boolean) => void,
    private readonly quietMs = BUSY_QUIET_MS,
  ) {}

  busyIds(): string[] {
    return [...this.timers.keys()];
  }

  isBusy(execId: string): boolean {
    return this.timers.has(execId);
  }

  activity(execId: string, at: Date = this.clock.now()): void {
    const wasBusy = this.timers.has(execId);
    this.timers.get(execId)?.();
    const remaining = this.quietMs - (this.clock.now().getTime() - at.getTime());
    if (remaining <= 0) {
      this.timers.delete(execId);
      if (wasBusy) this.onChange(execId, false);
      return;
    }
    this.timers.set(
      execId,
      this.clock.setTimeout(() => {
        this.timers.delete(execId);
        this.onChange(execId, false);
      }, remaining),
    );
    if (!wasBusy) this.onChange(execId, true);
  }

  ended(execId: string): void {
    const cancel = this.timers.get(execId);
    if (!cancel) return;
    cancel();
    this.timers.delete(execId);
    this.onChange(execId, false);
  }

  /** Espera até a execução ficar ociosa (ou já estar). */
  whenIdle(execId: string): Promise<void> {
    if (!this.isBusy(execId)) return Promise.resolve();
    return new Promise((resolve) => {
      const tick = () => {
        if (!this.isBusy(execId)) resolve();
        else this.clock.setTimeout(tick, 100);
      };
      this.clock.setTimeout(tick, 100);
    });
  }
}
