import type { Cancel, Clock } from '../core/ports/clock';

export const IDLE_EXIT_MS = 60_000;

/** Encerra o hospedeiro após 60 s sem processos vivos e sem conexões. */
export class IdleExit {
  private cancel: Cancel | undefined;

  constructor(
    private readonly clock: Clock,
    private readonly counts: () => { alive: number; connections: number },
    private readonly onIdle: () => void,
    private readonly ms = IDLE_EXIT_MS,
  ) {}

  /** Reavalia após qualquer mudança (conexão, spawn, saída). */
  evaluate(): void {
    const { alive, connections } = this.counts();
    if (alive > 0 || connections > 0) {
      this.cancel?.();
      this.cancel = undefined;
      return;
    }
    if (this.cancel) return;
    this.cancel = this.clock.setTimeout(() => {
      this.cancel = undefined;
      const now = this.counts();
      if (now.alive === 0 && now.connections === 0) this.onIdle();
    }, this.ms);
  }

  /** Atividade que reinicia a contagem mesmo sem mudar as contagens. */
  touch(): void {
    this.cancel?.();
    this.cancel = undefined;
    this.evaluate();
  }

  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }
}
