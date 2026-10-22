import { describe, expect, it } from 'vitest';
import { createLayoutStore, paneIds } from '../../../src/renderer/store/layout-store';
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
      panes: [
        { id: 'a', kind: 'executions', execIds: ['a'], activeIndex: 0 },
        { id: 'b', kind: 'executions', execIds: ['b'], activeIndex: 0 },
      ],
      focusedPaneId: 'a',
    });
  });

  it('reopens the persisted panels on load', async () => {
    const api = fakeApi();
    api.layout.get.mockImplementation(() =>
      okR({
        mode: 'spotlight' as const,
        panes: [
          { id: 'x', kind: 'executions' as const, execIds: ['x'], activeIndex: 0 },
          { id: 'y', kind: 'executions' as const, execIds: ['y'], activeIndex: 0 },
        ],
        focusedPaneId: 'y',
        custom: { columns: [1], rows: [1], cells: {} },
      }),
    );
    const store = createLayoutStore(api, manualSchedule().schedule);
    let notified = 0;
    store.subscribe(() => notified++);
    await store.load();
    expect(paneIds(store.get())).toEqual(['x', 'y']);
    expect(store.get().focusedPaneId).toBe('y');
    expect(store.get().mode).toBe('auto');
    expect(notified).toBe(1);
  });

  it('caps at 12 panels, moves the focus on close and prunes unknown executions', async () => {
    const api = fakeApi();
    const store = createLayoutStore(api, manualSchedule().schedule);
    for (let i = 0; i < 14; i++) store.open(`e${i}`);
    expect(paneIds(store.get())).toHaveLength(12);
    expect(paneIds(store.get())[0]).toBe('e2');
    store.close('e13');
    expect(store.get().focusedPaneId).toBe('e2');
    store.prune(new Set(['e2', 'e3']));
    expect(paneIds(store.get())).toEqual(['e2', 'e3']);
  });

  it('opens documents in one editor pane and adds tabs to it', () => {
    const store = createLayoutStore(fakeApi(), manualSchedule().schedule);
    store.openDoc('/ws/a.ts');
    store.openDoc('/ws/b.ts');
    const panes = store.get().panes;
    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({
      kind: 'editor',
      docs: ['/ws/a.ts', '/ws/b.ts'],
      activeIndex: 1,
    });
    // reabrir um documento já aberto só ativa a aba dele
    store.openDoc('/ws/a.ts');
    expect(store.get().panes[0]).toMatchObject({ activeIndex: 0 });
    expect(store.get().focusedPaneId).toBe(panes[0]?.id);
  });

  it('gives a terminal panel several tabs and closes them one by one', () => {
    const store = createLayoutStore(fakeApi(), manualSchedule().schedule);
    store.open('e1');
    store.setActive('e1', 0);
    const pane = store.get().panes[0];
    if (pane?.kind !== 'executions') throw new Error('esperava painel de execuções');
    store.closeTab('e1', 0);
    // fechar a última aba fecha o painel
    expect(store.get().panes).toEqual([]);
    expect(store.get().focusedPaneId).toBeNull();
  });
});
