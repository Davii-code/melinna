import { describe, expect, it } from 'vitest';
import { FlowControl, HIGH_WATER, LOW_WATER } from '../../../src/host/flow-control';

function target() {
  const calls: string[] = [];
  return { calls, pause: () => calls.push('pause'), resume: () => calls.push('resume') };
}

describe('FlowControl', () => {
  it('pauses above 1 MB unacked and resumes below 256 KB', () => {
    const t = target();
    const fc = new FlowControl<string>(t);
    fc.add('c', 0);
    fc.sent('c', HIGH_WATER);
    expect(fc.isPaused()).toBe(false);
    fc.sent('c', HIGH_WATER + 1);
    expect(t.calls).toEqual(['pause']);
    fc.ack('c', HIGH_WATER + 1 - LOW_WATER);
    expect(fc.isPaused()).toBe(true);
    fc.ack('c', HIGH_WATER + 2 - LOW_WATER);
    expect(t.calls).toEqual(['pause', 'resume']);
  });

  it('resumes when the consumer detaches and never pauses without consumers', () => {
    const t = target();
    const fc = new FlowControl<string>(t);
    fc.sent('x', 10 * HIGH_WATER);
    expect(t.calls).toEqual([]);
    fc.add('c', 100);
    fc.sent('c', 100 + 2 * HIGH_WATER);
    fc.remove('c');
    expect(t.calls).toEqual(['pause', 'resume']);
  });

  it('ignores acks beyond what was sent', () => {
    const t = target();
    const fc = new FlowControl<string>(t);
    fc.add('c', 0);
    fc.sent('c', 50);
    fc.ack('c', 999);
    expect(fc.unacked('c')).toBe(0);
  });
});
