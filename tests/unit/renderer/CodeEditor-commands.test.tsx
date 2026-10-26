import { selectAll } from '@codemirror/commands';
import { replaceAll, SearchQuery, setSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { EditorPane } from '../../../src/renderer/components/Editor/EditorPane';
import {
  getEditorController,
  type EditorController,
} from '../../../src/renderer/components/Editor/editor-controller';
import type { Pane } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

function paneFor(path: string): Extract<Pane, { kind: 'editor' }> {
  return { id: 'editor-1', kind: 'editor', docs: [path], activeIndex: 0 };
}

async function open(path: string, content: string) {
  const api = fakeApi();
  api.files.read.mockImplementation(() =>
    okR({ path, content, size: content.length, binary: false, truncated: false, hash: 'a'.repeat(64) }),
  );
  const { unmount } = render(
    <ApiContext.Provider value={api}>
      <EditorPane
        pane={paneFor(path)}
        focused
        onFocus={() => undefined}
        onSelect={() => undefined}
        onCloseTab={() => undefined}
      />
    </ApiContext.Provider>,
  );
  await waitFor(() => expect(getEditorController('editor-1')).toBeDefined());
  const controller = getEditorController('editor-1') as EditorController;
  const dom = document.querySelector('.cm-editor') as HTMLElement;
  const view = EditorView.findFromDOM(dom) as EditorView;
  return { api, controller, view, unmount };
}

const text = (view: EditorView) => view.state.doc.toString();

describe('comandos do editor deixam a aba não salva e nunca gravam', () => {
  it('comment and uncomment lines mark the tab as unsaved and do not call files.write', async () => {
    const { api, controller, view } = await open('/ws/a.ts', 'const a = 1;\nconst b = 2;');
    expect(screen.queryByLabelText('não salvo')).toBeNull();
    act(() => {
      selectAll(view);
      expect(controller.toggleComment()).toBe(true);
    });
    expect(text(view)).toBe('// const a = 1;\n// const b = 2;');
    expect(await screen.findByLabelText('não salvo')).toBeTruthy();
    act(() => {
      expect(controller.toggleComment()).toBe(true);
    });
    expect(text(view)).toBe('const a = 1;\nconst b = 2;');
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('toggle comment does nothing in a language without comment syntax', async () => {
    const { api, controller, view } = await open('/ws/notas.txt', 'texto puro');
    let handled = true;
    act(() => {
      handled = controller.toggleComment();
    });
    expect(handled).toBe(false);
    expect(text(view)).toBe('texto puro');
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('reindent changes the text of the selected lines as an ordinary edit', async () => {
    const { api, controller, view } = await open('/ws/a.ts', 'function f() {\nreturn 1;\n}');
    act(() => {
      selectAll(view);
      controller.reindent();
    });
    expect(text(view)).toBe('function f() {\n  return 1;\n}');
    expect(await screen.findByLabelText('não salvo')).toBeTruthy();
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('replace in the file changes only the tab text', async () => {
    const { api, controller, view } = await open('/ws/a.ts', 'foo foo\nfoo');
    act(() => {
      controller.openReplace();
    });
    expect(document.querySelector('.cm-search')).not.toBeNull();
    act(() => {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'foo', replace: 'bar' })) });
      replaceAll(view);
    });
    expect(text(view)).toBe('bar bar\nbar');
    expect(await screen.findByLabelText('não salvo')).toBeTruthy();
    expect(api.files.write).not.toHaveBeenCalled();
  });

  it('go to line, next occurrence and reveal do not edit the text nor mark the tab', async () => {
    const { api, controller, view } = await open('/ws/a.ts', 'alfa\nbeta alfa\ngama');
    act(() => {
      controller.goToLine({ line: 2, column: 6 });
      controller.revealMatch(2, 6, 4);
    });
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('alfa');
    act(() => {
      controller.selectNextOccurrence();
    });
    expect(text(view)).toBe('alfa\nbeta alfa\ngama');
    expect(screen.queryByLabelText('não salvo')).toBeNull();
    expect(api.files.write).not.toHaveBeenCalled();
  });
});

describe('controller do editor', () => {
  it('reports the number of lines and the symbols of the file', async () => {
    const { controller } = await open('/ws/a.ts', 'function um() {}\nfunction dois() {}');
    expect(controller.lineCount()).toBe(2);
    expect(controller.symbols().map((s) => s.name)).toEqual(['um', 'dois']);
  });

  it('goToPosition moves the cursor to a symbol', async () => {
    const { controller, view } = await open('/ws/a.ts', 'function um() {}\nfunction dois() {}');
    const dois = controller.symbols()[1];
    act(() => controller.goToPosition(dois?.from ?? 0));
    expect(view.state.selection.main.head).toBe(17);
  });

  it('selectedText returns the selection, or the word under the cursor', async () => {
    const { controller, view } = await open('/ws/a.ts', 'alfa beta');
    act(() => view.dispatch({ selection: { anchor: 6 } }));
    expect(controller.selectedText()).toBe('beta');
    act(() => view.dispatch({ selection: { anchor: 0, head: 4 } }));
    expect(controller.selectedText()).toBe('alfa');
    act(() => view.dispatch({ selection: { anchor: 4 } }));
    expect(controller.selectedText()).toBe('alfa');
  });

  it('selectedText is empty on a blank spot', async () => {
    const { controller } = await open('/ws/a.ts', '   ');
    expect(controller.selectedText()).toBe('');
  });

  it('unregisters when the editor goes away', async () => {
    const { unmount } = await open('/ws/a.ts', 'x');
    expect(getEditorController('editor-1')).toBeDefined();
    unmount();
    expect(getEditorController('editor-1')).toBeUndefined();
    expect(getEditorController(null)).toBeUndefined();
  });

  it('wires next occurrence and its undo through the controller', async () => {
    const { controller, view } = await open('/ws/a.ts', 'ab ab ab');
    act(() => view.dispatch({ selection: { anchor: 1 } }));
    act(() => {
      controller.selectNextOccurrence();
      controller.selectNextOccurrence();
      controller.selectNextOccurrence();
    });
    expect(view.state.selection.ranges).toHaveLength(3);
    act(() => {
      controller.unselectLastOccurrence();
    });
    expect(view.state.selection.ranges).toHaveLength(2);
  });
});
