import { describe, expect, it } from 'vitest';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import { fakeApi, okR } from '../../support/fake-api';

function manualSchedule() {
  const queue: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => {
      queue.push(fn);
      return () => {
        const i = queue.indexOf(fn);
        if (i >= 0) queue.splice(i, 1);
      };
    },
    run: () => queue.splice(0).forEach((f) => f()),
  };
}

describe('layout store', () => {
  it('persists open panels with a debounced layout.set', async () => {
    const api = fakeApi();
    const s = manualSchedule();
    const store = createLayoutStore(api, s.schedule);
    store.open('a');
    store.open('b');
    store.open('a');
    expect(api.layout.set).not.toHaveBeenCalled();
    s.run();
    await store.flush();
    expect(api.layout.set).toHaveBeenCalledTimes(1);
    expect(api.layout.set.mock.calls[0]?.[0]).toMatchObject({
      openExecutionIds: ['a', 'b'],
      focusedExecutionId: 'a',
    });
  });

  it('reopens the persisted panels on load', async () => {
    const api = fakeApi();
    api.layout.get.mockImplementation(() =>
      okR({
        mode: 'spotlight' as const,
        openExecutionIds: ['x', 'y'],
        focusedExecutionId: 'y',
        custom: { columns: [1], rows: [1], cells: {} },
      }),
    );
    const store = createLayoutStore(api, manualSchedule().schedule);
    let notified = 0;
    store.subscribe(() => notified++);
    await store.load();
    expect(store.get()).toMatchObject({
      mode: 'spotlight',
      openExecutionIds: ['x', 'y'],
      focusedExecutionId: 'y',
    });
    expect(notified).toBe(1);
  });

  it('closing a panel moves the focus, caps at 12 and prunes unknown executions', async () => {
    const api = fakeApi();
    const store = createLayoutStore(api, manualSchedule().schedule);
    for (let i = 0; i < 14; i++) store.open(`e${i}`);
    expect(store.get().openExecutionIds).toHaveLength(12);
    expect(store.get().openExecutionIds[0]).toBe('e2');
    store.close('e13');
    expect(store.get().focusedExecutionId).toBe('e2');
    store.prune(new Set(['e2', 'e3']));
    expect(store.get().openExecutionIds).toEqual(['e2', 'e3']);
  });
});
