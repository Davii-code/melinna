import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import type { CodeEditorProps } from '../../../src/renderer/components/Editor/CodeEditor';
import { EditorPane } from '../../../src/renderer/components/Editor/EditorPane';
import {
  createClosedTabs,
  createEditorSession,
  EditorSessionProvider,
  MAX_CLOSED_TABS,
  type ClosedTab,
  type EditorSession,
} from '../../../src/renderer/components/Editor/editor-session';
import type { Pane } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

type EditorModel = Extract<Pane, { kind: 'editor' }>;

const pane = (activeIndex = 0, docs = ['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']): EditorModel => ({
  id: 'editor-1',
  kind: 'editor',
  docs,
  activeIndex,
});

function FakeEditor({ path, value, onChange }: CodeEditorProps) {
  return <textarea aria-label={`editor-${path}`} value={value} onChange={(e) => onChange(e.target.value)} />;
}

const hashOf = (path: string) => (path.endsWith('a.ts') ? 'a' : path.endsWith('b.ts') ? 'b' : 'c').repeat(64);

function setup(opts: { split?: boolean; session?: EditorSession } = {}) {
  const api = fakeApi();
  api.files.read.mockImplementation((path: string) =>
    okR({ path, content: `texto de ${path}`, size: 10, binary: false, truncated: false, hash: hashOf(path) }),
  );
  const session = opts.session ?? createEditorSession();
  const handlers = {
    onFocus: vi.fn(),
    onSelect: vi.fn(),
    onCloseTab: vi.fn(),
    onSplit: vi.fn(),
    onReopenTab: vi.fn(),
  };
  const view = (model: EditorModel) => (
    <ApiContext.Provider value={api}>
      <EditorSessionProvider session={session}>
        <EditorPane
          pane={model}
          focused
          onFocus={handlers.onFocus}
          onSelect={handlers.onSelect}
          onCloseTab={handlers.onCloseTab}
          onReopenTab={handlers.onReopenTab}
          {...(opts.split === false ? {} : { onSplit: handlers.onSplit })}
          renderEditor={(props) => <FakeEditor {...props} />}
        />
      </EditorSessionProvider>
    </ApiContext.Provider>
  );
  const { rerender } = render(view(pane()));
  return { api, session, ...handlers, show: (model: EditorModel) => rerender(view(model)) };
}

/** Edita o arquivo ativo e muda para o seguinte, para ter vários rascunhos sujos. */
async function dirty(ctx: ReturnType<typeof setup>, paths: { path: string; index: number }[]) {
  for (const { path, index } of paths) {
    ctx.show(pane(index));
    fireEvent.change(await screen.findByLabelText(`editor-${path}`), {
      target: { value: `editado ${path}` },
    });
  }
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^(não salvo)?${name}$`) });
const openTabMenu = (name: string) => {
  fireEvent.contextMenu(tab(name));
  return screen.getByRole('menu', { name: 'Menu da aba' });
};
const item = (menu: HTMLElement, name: string) =>
  within(menu).getByRole('menuitem', { name }) as HTMLButtonElement;
const paneMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Menu do painel' }));
  return screen.getByRole('menu', { name: 'Menu do painel' });
};

describe('EditorPane — menu da aba', () => {
  it('opens on right click with the items of the tab menu', async () => {
    setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    const menu = openTabMenu('b.ts');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Fechar', 'Fechar outras', 'Fechar todas', 'Dividir à direita', 'Dividir abaixo']);
  });

  it('opens from the keyboard with the context menu key and Shift+F10', async () => {
    setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.keyDown(tab('b.ts'), { key: 'ContextMenu' });
    expect(screen.getByRole('menu', { name: 'Menu da aba' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu', { name: 'Menu da aba' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Menu da aba' })).toBeNull();
    fireEvent.keyDown(tab('c.ts'), { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Menu da aba' })).toBeTruthy();
  });

  it('hides the split items when the app does not offer to split', async () => {
    setup({ split: false });
    await screen.findByLabelText('editor-/ws/a.ts');
    const menu = openTabMenu('a.ts');
    expect(within(menu).queryByRole('menuitem', { name: /Dividir/ })).toBeNull();
  });

  it('asks the app to split the file of the tab to the right or down', async () => {
    const { onSplit } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(item(openTabMenu('b.ts'), 'Dividir à direita'));
    expect(onSplit).toHaveBeenLastCalledWith('/ws/b.ts', 'right');
    fireEvent.click(item(openTabMenu('c.ts'), 'Dividir abaixo'));
    expect(onSplit).toHaveBeenLastCalledWith('/ws/c.ts', 'down');
  });

  it('closes the menu when the user clicks elsewhere', async () => {
    setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    openTabMenu('b.ts');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Menu da aba' })).toBeNull();
  });

  it('disables "Fechar outras" when there is only one tab', async () => {
    const { show } = setup();
    show(pane(0, ['/ws/a.ts']));
    await screen.findByLabelText('editor-/ws/a.ts');
    expect(item(openTabMenu('a.ts'), 'Fechar outras').disabled).toBe(true);
  });
});

describe('EditorPane — fechar outras e fechar todas', () => {
  it('"Fechar" closes the tab of the menu', async () => {
    const { onCloseTab } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(item(openTabMenu('b.ts'), 'Fechar'));
    expect(onCloseTab).toHaveBeenCalledTimes(1);
    expect(onCloseTab).toHaveBeenCalledWith('/ws/b.ts');
  });

  it('"Fechar outras" closes every tab but the chosen one', async () => {
    const { onCloseTab } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(item(openTabMenu('b.ts'), 'Fechar outras'));
    expect(onCloseTab.mock.calls.map((c) => c[0])).toEqual(['/ws/a.ts', '/ws/c.ts']);
  });

  it('"Fechar todas" closes all the tabs', async () => {
    const { onCloseTab } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(item(openTabMenu('a.ts'), 'Fechar todas'));
    expect(onCloseTab.mock.calls.map((c) => c[0])).toEqual(['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']);
  });

  it('asks once for all the unsaved files, listing them', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [
      { path: '/ws/a.ts', index: 0 },
      { path: '/ws/b.ts', index: 1 },
    ]);
    fireEvent.click(item(openTabMenu('c.ts'), 'Fechar todas'));
    const ask = screen.getByRole('alertdialog', { name: 'Alterações não salvas' });
    expect(within(ask).getByText('2 arquivos têm alterações não salvas:')).toBeTruthy();
    expect(
      within(ask)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['a.ts', 'b.ts']);
    expect(ctx.onCloseTab).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });

  it('"Cancelar" keeps every tab and writes nothing', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [{ path: '/ws/a.ts', index: 0 }]);
    fireEvent.click(item(openTabMenu('b.ts'), 'Fechar todas'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(ctx.onCloseTab).not.toHaveBeenCalled();
    expect(ctx.api.files.write).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('"Descartar todos" closes everything without writing', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [{ path: '/ws/a.ts', index: 0 }]);
    fireEvent.click(item(openTabMenu('b.ts'), 'Fechar outras'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar todos' }));
    expect(ctx.onCloseTab.mock.calls.map((c) => c[0])).toEqual(['/ws/a.ts', '/ws/c.ts']);
    expect(ctx.api.files.write).not.toHaveBeenCalled();
    expect(ctx.session.drafts.snapshot()['/ws/a.ts']).toBeUndefined();
  });

  it('"Salvar todos" writes file by file with the hash each one was read with, then closes', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [
      { path: '/ws/a.ts', index: 0 },
      { path: '/ws/b.ts', index: 1 },
    ]);
    fireEvent.click(item(openTabMenu('c.ts'), 'Fechar todas'));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Salvar todos' }));
    });
    expect(ctx.api.files.write.mock.calls).toEqual([
      ['/ws/a.ts', 'editado /ws/a.ts', hashOf('/ws/a.ts')],
      ['/ws/b.ts', 'editado /ws/b.ts', hashOf('/ws/b.ts')],
    ]);
    expect(ctx.onCloseTab.mock.calls.map((c) => c[0])).toEqual(['/ws/a.ts', '/ws/b.ts', '/ws/c.ts']);
  });

  it('reports a conflict on one file and keeps that tab open while the others close', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [
      { path: '/ws/a.ts', index: 0 },
      { path: '/ws/b.ts', index: 1 },
    ]);
    ctx.api.files.write.mockImplementation((path: string) =>
      path === '/ws/a.ts'
        ? Promise.resolve({
            ok: false as const,
            error: {
              code: 'FILE_CONFLICT' as const,
              message: 'O arquivo mudou no disco desde que foi aberto.',
            },
          })
        : okR({ path, size: 1, hash: 'f'.repeat(64) }),
    );
    fireEvent.click(item(openTabMenu('c.ts'), 'Fechar todas'));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Salvar todos' }));
    });
    expect(ctx.onCloseTab.mock.calls.map((c) => c[0])).toEqual(['/ws/b.ts', '/ws/c.ts']);
    expect(screen.getByRole('alert').textContent).toContain('a.ts: O arquivo mudou no disco');
    expect(ctx.session.drafts.snapshot()['/ws/a.ts']?.dirty).toBe(true);
  });

  it('does not lose text that another pane still shows (split)', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [{ path: '/ws/a.ts', index: 0 }]);
    ctx.session.panes.register('editor-2', ['/ws/a.ts']);
    fireEvent.click(item(openTabMenu('b.ts'), 'Fechar outras'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(ctx.onCloseTab.mock.calls.map((c) => c[0])).toEqual(['/ws/a.ts', '/ws/c.ts']);
    expect(ctx.session.drafts.snapshot()['/ws/a.ts']?.dirty).toBe(true);
  });
});

describe('EditorPane — salvar todos', () => {
  it('saves every unsaved tab of the pane from the pane menu', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [
      { path: '/ws/a.ts', index: 0 },
      { path: '/ws/c.ts', index: 2 },
    ]);
    const saveAll = within(paneMenu()).getByRole('menuitem', { name: 'Salvar todos' });
    await act(async () => {
      fireEvent.click(saveAll);
    });
    expect(ctx.api.files.write.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['/ws/a.ts', hashOf('/ws/a.ts')],
      ['/ws/c.ts', hashOf('/ws/c.ts')],
    ]);
    await waitFor(() => expect(screen.queryByLabelText('não salvo')).toBeNull());
  });

  it('is disabled without unsaved files', async () => {
    setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    expect(
      (within(paneMenu()).getByRole('menuitem', { name: 'Salvar todos' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('writes only after the explicit command, never when closing with discard', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [{ path: '/ws/a.ts', index: 0 }]);
    expect(ctx.api.files.write).not.toHaveBeenCalled();
  });
});

describe('EditorPane — reabrir aba fechada', () => {
  it('is disabled while nothing was closed', async () => {
    setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    expect(
      (within(paneMenu()).getByRole('menuitem', { name: 'Reabrir aba fechada' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('remembers the pane and the position of the closed tab and hands it back', async () => {
    const { onReopenTab } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(screen.getByLabelText('Fechar b.ts'));
    fireEvent.click(within(paneMenu()).getByRole('menuitem', { name: 'Reabrir aba fechada' }));
    expect(onReopenTab).toHaveBeenCalledWith({ paneId: 'editor-1', path: '/ws/b.ts', index: 1 });
  });

  it('reopens the most recent first', async () => {
    const { onReopenTab } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(screen.getByLabelText('Fechar b.ts'));
    fireEvent.click(screen.getByLabelText('Fechar c.ts'));
    fireEvent.click(within(paneMenu()).getByRole('menuitem', { name: 'Reabrir aba fechada' }));
    fireEvent.click(within(paneMenu()).getByRole('menuitem', { name: 'Reabrir aba fechada' }));
    expect(onReopenTab.mock.calls.map((c) => (c[0] as ClosedTab).path)).toEqual(['/ws/c.ts', '/ws/b.ts']);
    expect(
      (within(paneMenu()).getByRole('menuitem', { name: 'Reabrir aba fechada' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('records the positions of "Fechar outras" so the tabs come back in place', async () => {
    const { session } = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(item(openTabMenu('b.ts'), 'Fechar outras'));
    expect(session.closed.pop()).toEqual({ paneId: 'editor-1', path: '/ws/c.ts', index: 2 });
    expect(session.closed.pop()).toEqual({ paneId: 'editor-1', path: '/ws/a.ts', index: 0 });
  });

  it('does not record a tab whose close the user refused', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    await dirty(ctx, [{ path: '/ws/a.ts', index: 0 }]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByLabelText('Fechar a.ts'));
    confirm.mockRestore();
    expect(ctx.session.closed.size()).toBe(0);
  });

  it('forgets the draft of a closed tab so reopening reads the disk again', async () => {
    const ctx = setup();
    await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.click(screen.getByLabelText('Fechar a.ts'));
    expect(ctx.session.drafts.snapshot()['/ws/a.ts']).toBeUndefined();
  });
});

describe('ClosedTabs', () => {
  const t = (n: number): ClosedTab => ({ paneId: 'p', path: `/f${n}`, index: n });

  it('is a stack: the last closed comes out first', () => {
    const closed = createClosedTabs();
    closed.push(t(1));
    closed.push(t(2));
    expect(closed.size()).toBe(2);
    expect(closed.pop()).toEqual(t(2));
    expect(closed.pop()).toEqual(t(1));
    expect(closed.pop()).toBeUndefined();
  });

  it('keeps at most 20, dropping the oldest', () => {
    const closed = createClosedTabs();
    for (let i = 0; i < MAX_CLOSED_TABS + 5; i++) closed.push(t(i));
    expect(closed.size()).toBe(20);
    const first = Array.from({ length: 20 }, () => closed.pop()?.index);
    expect(first[0]).toBe(24);
    expect(first.at(-1)).toBe(5);
  });

  it('notifies subscribers on push and pop', () => {
    const closed = createClosedTabs();
    const fn = vi.fn();
    const off = closed.subscribe(fn);
    closed.push(t(1));
    closed.pop();
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    closed.push(t(2));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
