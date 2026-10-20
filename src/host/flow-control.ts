export const HIGH_WATER = 1024 * 1024;
export const LOW_WATER = 256 * 1024;

export interface Pausable {
  pause(): void;
  resume(): void;
}

/**
 * Controle de fluxo por execução: pausa o PTY quando algum consumidor anexado tem mais de 1 MB sem `ack`
 * e retoma quando todos ficam abaixo de 256 KB. Sem consumidores anexados, nunca fica pausado.
 */
export class FlowControl<K> {
  private readonly consumers = new Map<K, { sent: number; acked: number }>();
  private paused = false;

  constructor(private readonly target: Pausable) {}

  isPaused(): boolean {
    return this.paused;
  }

  add(consumer: K, offset: number): void {
    this.consumers.set(consumer, { sent: offset, acked: offset });
  }

  remove(consumer: K): void {
    this.consumers.delete(consumer);
    this.evaluate();
  }

  /** Registra que bytes até `endOffset` foram enviados ao consumidor. */
  sent(consumer: K, endOffset: number): void {
    const c = this.consumers.get(consumer);
    if (!c) return;
    c.sent = Math.max(c.sent, endOffset);
    this.evaluate();
  }

  ack(consumer: K, offset: number): void {
    const c = this.consumers.get(consumer);
    if (!c) return;
    c.acked = Math.min(c.sent, Math.max(c.acked, offset));
    this.evaluate();
  }

  unacked(consumer: K): number {
    const c = this.consumers.get(consumer);
    return c ? c.sent - c.acked : 0;
  }

  private evaluate(): void {
    let max = 0;
    for (const c of this.consumers.values()) max = Math.max(max, c.sent - c.acked);
    if (!this.paused && max > HIGH_WATER) {
      this.paused = true;
      this.target.pause();
    } else if (this.paused && max < LOW_WATER) {
      this.paused = false;
      this.target.resume();
    }
  }
}
