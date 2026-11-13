import { describe, expect, it, vi } from 'vitest';
import { runSelectedConfiguration } from '../../../src/renderer/components/Ide/run-selection';
import type { RunState } from '../../../src/renderer/store/run-store';

describe('debug tool run selection', () => {
  it('does not launch an old configuration when persisting the new selection fails', async () => {
    const store = {
      choose: vi.fn(async () => undefined),
      get: () => ({ active: { groupId: 'g', commandId: 'old' } }) as RunState,
      run: vi.fn(async () => undefined),
    };
    await runSelectedConfiguration(store, 'g', 'new');
    expect(store.run).not.toHaveBeenCalled();
  });
  it('uses the existing run store when the requested configuration is active', async () => {
    const store = {
      choose: vi.fn(async () => undefined),
      get: () => ({ active: { groupId: 'g', commandId: 'new' } }) as RunState,
      run: vi.fn(async () => undefined),
    };
    await runSelectedConfiguration(store, 'g', 'new');
    expect(store.run).toHaveBeenCalledOnce();
  });
});
