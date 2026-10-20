import type { Cancel, Clock } from '../core/ports/clock';

export class NodeClock implements Clock {
  now(): Date {
    return new Date();
  }
  setTimeout(fn: () => void, ms: number): Cancel {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  }
}
