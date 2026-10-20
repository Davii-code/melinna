import type { Cancel, Clock } from '../../../src/core/ports/clock';

interface Timer {
  at: number;
  seq: number;
  fn: () => void;
}

/** Relógio controlável: o tempo só anda com `advance`. */
export class FakeClock implements Clock {
  private ms: number;
  private seq = 0;
  private timers: Timer[] = [];

  constructor(start = Date.parse('2026-01-01T00:00:00.000Z')) {
    this.ms = start;
  }

  now(): Date {
    return new Date(this.ms);
  }

  setTimeout(fn: () => void, ms: number): Cancel {
    const timer: Timer = { at: this.ms + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((t) => t !== timer);
    };
  }

  advance(ms: number): void {
    const target = this.ms + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.ms = due.at;
      due.fn();
    }
    this.ms = target;
  }

  pending(): number {
    return this.timers.length;
  }
}
