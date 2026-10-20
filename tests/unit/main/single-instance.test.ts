import { describe, expect, it } from 'vitest';
import { claimSingleInstance } from '../../../src/main/single-instance';

function fakeApp(lock: boolean) {
  const state = { quit: false, second: undefined as (() => void) | undefined };
  return {
    state,
    app: {
      requestSingleInstanceLock: () => lock,
      quit: () => (state.quit = true),
      on: (_e: 'second-instance', fn: () => void) => (state.second = fn),
    },
  };
}

describe('single instance', () => {
  it('a second instance quits', () => {
    const { app, state } = fakeApp(false);
    expect(claimSingleInstance(app, () => null)).toBe(false);
    expect(state.quit).toBe(true);
  });

  it('the first instance focuses its window when another one starts', () => {
    const { app, state } = fakeApp(true);
    const calls: string[] = [];
    const win = {
      isMinimized: () => true,
      restore: () => calls.push('restore'),
      focus: () => calls.push('focus'),
    };
    expect(claimSingleInstance(app, () => win)).toBe(true);
    expect(state.quit).toBe(false);
    state.second?.();
    expect(calls).toEqual(['restore', 'focus']);
  });
});
