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

describe('layout store — fechar por caminho e reabrir na posição', () => {
  const editor = (store: ReturnType<typeof createLayoutStore>, paneId = 'editor-1') => {
    const pane = store.get().panes.find((p) => p.id === paneId);
    return pane && pane.kind === 'editor' ? pane : undefined;
  };

  function withDocs(...paths: string[]) {
    const store = createLayoutStore(fakeApi(), manualSchedule().schedule);
    for (const path of paths) store.openDoc(path);
    return store;
  }

  it('closeDoc closes the tab by path over the current state', () => {
    const store = withDocs('/a', '/b', '/c');
    store.closeDoc('editor-1', '/a');
    store.closeDoc('editor-1', '/b');
    expect(editor(store)?.docs).toEqual(['/c']);
  });

  it('closeDoc ignores a path that is not open, a missing pane and a terminal pane', () => {
    const store = withDocs('/a', '/b');
    store.open('exec-1');
    const before = store.get();
    store.closeDoc('editor-1', '/nada');
    store.closeDoc('nao-existe', '/a');
    store.closeDoc('exec-1', '/a');
    expect(store.get()).toBe(before);
  });

  it('closeDoc on the last tab closes the pane', () => {
    const store = withDocs('/a');
    store.closeDoc('editor-1', '/a');
    expect(store.get().panes).toEqual([]);
  });

  it('openDocAt puts the file back at its position and activates it', () => {
    const store = withDocs('/a', '/b', '/c');
    store.closeDoc('editor-1', '/b');
    store.openDocAt('editor-1', '/b', 1);
    expect(editor(store)).toMatchObject({ docs: ['/a', '/b', '/c'], activeIndex: 1 });
    expect(store.get().focusedPaneId).toBe('editor-1');
  });

  it('openDocAt clamps a position past the end and a negative one', () => {
    const store = withDocs('/a', '/b');
    store.openDocAt('editor-1', '/z', 99);
    expect(editor(store)?.docs).toEqual(['/a', '/b', '/z']);
    store.openDocAt('editor-1', '/y', -4);
    expect(editor(store)?.docs).toEqual(['/y', '/a', '/b', '/z']);
    expect(editor(store)?.activeIndex).toBe(0);
  });

  it('openDocAt only activates a file that is already open', () => {
    const store = withDocs('/a', '/b');
    store.openDocAt('editor-1', '/a', 1);
    expect(editor(store)).toMatchObject({ docs: ['/a', '/b'], activeIndex: 0 });
  });

  it('openDocAt recreates a pane that was closed, with the same id', () => {
    const store = withDocs('/a');
    store.closeDoc('editor-1', '/a');
    store.openDocAt('editor-1', '/a', 0);
    expect(editor(store)).toMatchObject({ id: 'editor-1', docs: ['/a'], activeIndex: 0 });
    expect(store.get().focusedPaneId).toBe('editor-1');
  });

  it('openDocAt creates a new editor pane when the old id belongs to a terminal pane', () => {
    const store = createLayoutStore(fakeApi(), manualSchedule().schedule);
    store.open('editor-1');
    store.openDocAt('editor-1', '/z', 0);
    const created = store.get().panes.find((p) => p.kind === 'editor');
    expect(created).toMatchObject({ id: 'editor-2', docs: ['/z'], activeIndex: 0 });
    expect(store.get().panes.find((p) => p.id === 'editor-1')?.kind).toBe('executions');
  });
});

describe('layout store — editor dividido (splitDoc)', () => {
  function withDocs(...paths: string[]) {
    const store = createLayoutStore(fakeApi(), manualSchedule().schedule);
    for (const path of paths) store.openDoc(path);
    return store;
  }
  const docsOf = (store: ReturnType<typeof createLayoutStore>) =>
    store.get().panes.map((p) => (p.kind === 'editor' ? [p.id, ...p.docs] : [p.id]));

  it('opens the same file in a new editor pane right after the source, focused', () => {
    const store = withDocs('/a', '/b');
    store.open('exec-1');
    store.splitDoc('editor-1', '/a', 'right');
    expect(docsOf(store)).toEqual([['editor-1', '/a', '/b'], ['editor-2', '/a'], ['exec-1']]);
    expect(store.get().focusedPaneId).toBe('editor-2');
  });

  it('down puts the new pane at the end of the grid', () => {
    const store = withDocs('/a');
    store.open('exec-1');
    store.splitDoc('editor-1', '/a', 'down');
    expect(docsOf(store)).toEqual([['editor-1', '/a'], ['exec-1'], ['editor-2', '/a']]);
  });

  it('openDoc keeps reusing the first pane that has the path', () => {
    const store = withDocs('/a', '/b');
    store.splitDoc('editor-1', '/a', 'right');
    store.focus('editor-2');
    store.openDoc('/a');
    expect(store.get().focusedPaneId).toBe('editor-1');
    expect(docsOf(store)).toEqual([
      ['editor-1', '/a', '/b'],
      ['editor-2', '/a'],
    ]);
  });

  it('ignores an unknown source pane and respects the limit of 12 panes', () => {
    const store = withDocs('/a');
    store.splitDoc('nao-existe', '/a', 'right');
    expect(store.get().panes).toHaveLength(1);
    for (let i = 0; i < 11; i++) store.open(`exec-${i}`);
    expect(store.get().panes).toHaveLength(12);
    store.splitDoc('editor-1', '/a', 'right');
    expect(store.get().panes).toHaveLength(12);
  });

  it('loads and prunes a state with the same path in two editor panes', async () => {
    const api = fakeApi();
    api.layout.get.mockImplementation(() =>
      okR({
        mode: 'auto' as const,
        panes: [
          { id: 'editor-1', kind: 'editor' as const, docs: ['/a'], activeIndex: 0 },
          { id: 'editor-2', kind: 'editor' as const, docs: ['/a'], activeIndex: 0 },
          { id: 'x', kind: 'executions' as const, execIds: ['x'], activeIndex: 0 },
        ],
        focusedPaneId: 'editor-2',
        custom: { columns: [1], rows: [1], cells: {} },
      }),
    );
    const store = createLayoutStore(api, manualSchedule().schedule);
    await store.load();
    store.prune(new Set());
    expect(docsOf(store)).toEqual([
      ['editor-1', '/a'],
      ['editor-2', '/a'],
    ]);
    expect(store.get().focusedPaneId).toBe('editor-2');
  });
});
