/*
 * SC-007: nenhuma ação do editor desta feature grava arquivo sem o salvar explícito. Com o App montado e o
 * fakeApi: substituir, reindentar, comentar, "Reverter este trecho", editar no editor dividido, "Fechar
 * todas" com "Descartar todos" e abrir resultado da busca nunca chamam files.write; só "Salvar" e
 * "Salvar todos" chamam, sempre com o hash lido.
 */
import { replaceAll, SearchQuery, setSearchQuery } from '@codemirror/search';
import { selectAll } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/App';
import { getEditorController } from '../../../src/renderer/components/Editor/editor-controller';
import type { TerminalDeps } from '../../../src/renderer/components/TerminalView';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import { createWorkspaceStore } from '../../../src/renderer/store/workspace-store';
import type { PortReceiver } from '../../../src/renderer/terminal/port-receiver';
import { fakeApi, okR, repoStatus, snapshot } from '../../support/fake-api';

const terminal: TerminalDeps = {
  factory: () => {
    throw new Error('sem terminal neste teste');
  },
  receiver: {
    expect: () => ({ take: () => new Promise<MessagePort>(() => undefined), cancel: () => undefined }),
    dispose: () => undefined,
  } as PortReceiver,
  observeResize: () => () => undefined,
};

const A = '/ws/a.ts';
const B = '/ws/b.ts';
const CONTENT: Record<string, string> = {
  [A]: 'function f() {\nreturn 1;\n}\nconst x = 1;',
  [B]: 'const b = 2;',
};
const HASH: Record<string, string> = { [A]: 'a'.repeat(64), [B]: 'b'.repeat(64) };

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

async function setup() {
  const api = fakeApi();
  api.workspace.snapshot.mockImplementation(() =>
    okR(
      snapshot({
        groups: [
          {
            id: 'w1',
            name: 'ws',
            order: 0,
            folders: [{ id: 'f1', path: '/ws' }],
            primaryFolderId: 'f1',
            repoPath: '/ws',
          },
        ],
      }),
    ),
  );
  api.files.read.mockImplementation((path: string) =>
    okR({
      path,
      content: CONTENT[path] ?? '',
      size: 1,
      binary: false,
      truncated: false,
      hash: HASH[path] ?? 'c'.repeat(64),
    }),
  );
  api.git.status.mockImplementation(() => okR(repoStatus({ root: '/ws' })));
  api.git.fileAtHead.mockImplementation((_repo: string, path: string) =>
    okR({ text: `${CONTENT[path] ?? ''}\nlinha do commit` }),
  );
  api.files.searchProject.mockImplementation(() =>
    okR({
      hits: [{ path: B, line: 1, column: 7, preview: 'const b = 2;', matchStart: 6, matchEnd: 7 }],
      truncated: false,
      scannedFiles: 2,
      skipped: 0,
    }),
  );
  const workspaceStore = createWorkspaceStore(api);
  const layoutStore = createLayoutStore(api);
  render(<App api={api} terminal={terminal} workspaceStore={workspaceStore} layoutStore={layoutStore} />);
  await screen.findByRole('button', { name: 'Catálogo de agentes' });
  act(() => layoutStore.openDoc(A));
  await waitFor(() => expect(getEditorController('editor-1')).toBeDefined());
  const view = () =>
    EditorView.findFromDOM(
      document.querySelector('.editor-document:not(.editor-document-hidden) .cm-editor') as HTMLElement,
    ) as EditorView;
  return { api, layoutStore, view };
}

describe('nada é gravado sem o salvar explícito', () => {
  it('keyboard close shares the unsaved-file confirmation and cancel keeps the document', async () => {
    const { api, layoutStore, view } = await setup();
    act(() => view().dispatch({ changes: { from: 0, insert: '// unsaved\n' } }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      act(() =>
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }),
        ),
      );
      expect(confirm).toHaveBeenCalled();
      expect(layoutStore.get().panes.some((p) => p.id === 'editor-1')).toBe(true);
      expect(view().state.doc.toString()).toContain('// unsaved');
      expect(api.files.write).not.toHaveBeenCalled();
    } finally {
      confirm.mockRestore();
    }
  });

  it('replace, reindent, comment and revert a git block only change the tab text', async () => {
    const { api, view } = await setup();
    const editor = getEditorController('editor-1');
    act(() => {
      editor?.openReplace();
      view().dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'x', replace: 'y' })) });
      replaceAll(view());
      selectAll(view());
      editor?.reindent();
      editor?.toggleComment();
    });
    const mark = await waitFor(() => {
      const el = document.querySelector('.cm-git-gutter .git-mark');
      if (!el) throw new Error('sem marca do git');
      return el as HTMLElement;
    });
    fireEvent.mouseDown(mark);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reverter este trecho' }));
    });
    expect(await screen.findAllByLabelText('não salvo')).not.toHaveLength(0);
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('editing in the split editor does not write', async () => {
    const { api, layoutStore, view } = await setup();
    act(() => layoutStore.splitDoc('editor-1', A, 'right'));
    await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2));
    act(() => view().dispatch({ changes: { from: 0, insert: '// ' } }));
    await waitFor(() => expect(screen.getAllByLabelText('não salvo')).toHaveLength(2));
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('"Fechar todas" with "Descartar todos" does not write', async () => {
    const { api, layoutStore, view } = await setup();
    act(() => view().dispatch({ changes: { from: 0, insert: 'x' } }));
    act(() => layoutStore.openDoc(B));
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'b.ts' }));
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Menu da aba' })).getByRole('menuitem', {
        name: 'Fechar todas',
      }),
    );
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar todos' }));
    await waitFor(() => expect(document.querySelector('.cm-editor')).toBeNull());
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('opening a project search result does not write', async () => {
    const { api } = await setup();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }),
      );
    });
    const popup = await screen.findByRole('dialog', { name: 'Buscar no projeto' });
    fireEvent.change(within(popup).getByLabelText('Texto da busca'), { target: { value: 'b' } });
    await act(async () => {
      fireEvent.submit(within(popup).getByLabelText('Texto da busca').closest('form') as HTMLFormElement);
    });
    fireEvent.click(await within(popup).findByRole('option'));
    await screen.findByRole('tab', { name: 'b.ts' });
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('only "Salvar" and "Salvar todos" write, always with the hash that was read', async () => {
    const { api, layoutStore, view } = await setup();
    act(() => view().dispatch({ changes: { from: 0, insert: 'x' } }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    });
    expect(api.files.write).toHaveBeenCalledTimes(1);
    expect(api.files.write.mock.calls[0]?.[0]).toBe(A);
    expect(api.files.write.mock.calls[0]?.[2]).toBe(HASH[A]);

    act(() => layoutStore.openDoc(B));
    await waitFor(() => expect(view().state.doc.toString()).toBe(CONTENT[B]));
    act(() => view().dispatch({ changes: { from: 0, insert: 'y' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Menu do painel' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Salvar todos' }));
    });
    expect(api.files.write).toHaveBeenCalledTimes(2);
    expect(api.files.write.mock.calls[1]).toEqual([B, `y${CONTENT[B]}`, HASH[B]]);
  });
});
