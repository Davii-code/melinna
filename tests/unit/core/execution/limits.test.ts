import { describe, expect, it } from 'vitest';
import { MAX_LIVE_EXECUTIONS, assertWithinLimit, freeSlots } from '../../../../src/core/execution/limits';

describe('limits', () => {
  it('caps live executions at 12', () => {
    expect(MAX_LIVE_EXECUTIONS).toBe(12);
    expect(freeSlots(0)).toBe(12);
    expect(freeSlots(10)).toBe(2);
    expect(freeSlots(15)).toBe(0);
  });

  it('throws LIMIT_REACHED when requesting more than the free slots', () => {
    expect(() => assertWithinLimit(10, 2)).not.toThrow();
    expect(() => assertWithinLimit(10, 3)).toThrow(expect.objectContaining({ code: 'LIMIT_REACHED' }));
    expect(() => assertWithinLimit(12, 1)).toThrow(expect.objectContaining({ code: 'LIMIT_REACHED' }));
  });
});
