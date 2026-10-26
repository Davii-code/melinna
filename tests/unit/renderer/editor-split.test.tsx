import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { EditorPane } from '../../../src/renderer/components/Editor/EditorPane';
import {
  createEditorSession,
  EditorSessionProvider,
} from '../../../src/renderer/components/Editor/editor-session';
import { sharedViewCount } from '../../../src/renderer/components/Editor/shared-doc';
import type { Pane } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const PATH = '/ws/a.ts';
const pane = (id: string): Extract<Pane, { kind: 'editor' }> => ({
  id,
  kind: 'editor',
  docs: [PATH],
  activeIndex: 0,
});

async function splitSetup() {
  const api = fakeApi();
  api.files.read.mockImplementation(() =>
    okR({
      path: PATH,
      content: 'linha um\nlinha dois',
      size: 19,
      binary: false,
      truncated: false,
      hash: 'a'.repeat(64),
    }),
  );
  const session = createEditorSession();
  const one = (id: string) => (
    <EditorPane
      pane={pane(id)}
      focused={false}
      onFocus={() => undefined}
      onSelect={() => undefined}
      onCloseTab={() => undefined}
    />
  );
  render(
    <ApiContext.Provider value={api}>
      <EditorSessionProvider session={session}>
        {one('editor-1')}
        {one('editor-2')}
      </EditorSessionProvider>
    </ApiContext.Provider>,
  );
  await waitFor(() => expect(document.querySelectorAll('.cm-editor')).toHaveLength(2));
  const views = [...document.querySelectorAll('.cm-editor')].map(
    (el) => EditorView.findFromDOM(el as HTMLElement) as EditorView,
  );
  const left = views[0] as EditorView;
  const right = views[1] as EditorView;
  const paneEl = (id: string) => screen.getByTestId(`editor-pane-${id}`);
  return { api, session, left, right, paneEl };
}

describe('editor dividido', () => {
  it('opens the same file in two editors with the same text, reading it once', async () => {
    const { api, left, right } = await splitSetup();
    expect(left.state.doc.toString()).toBe('linha um\nlinha dois');
    expect(right.state.doc.toString()).toBe('linha um\nlinha dois');
    expect(sharedViewCount(PATH)).toBe(2);
    expect(api.files.read.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('shows an edit made on one side on the other right away', async () => {
    const { left, right } = await splitSetup();
    act(() => {
      left.dispatch({ changes: { from: 0, insert: 'nova ' } });
    });
    expect(right.state.doc.toString()).toBe('nova linha um\nlinha dois');
    act(() => {
      right.dispatch({ changes: { from: right.state.doc.length, insert: '\nfim' } });
    });
    expect(left.state.doc.toString()).toBe('nova linha um\nlinha dois\nfim');
  });

  it('keeps the cursor of each side apart', async () => {
    const { left, right } = await splitSetup();
    act(() => {
      left.dispatch({ selection: { anchor: 5 } });
      right.dispatch({ selection: { anchor: 0 } });
    });
    expect(left.state.selection.main.head).not.toBe(right.state.selection.main.head);
  });

  it('marks the tab as unsaved on both sides', async () => {
    const { left, paneEl } = await splitSetup();
    act(() => {
      left.dispatch({ changes: { from: 0, insert: 'x' } });
    });
    await waitFor(() => expect(within(paneEl('editor-1')).getByLabelText('não salvo')).toBeTruthy());
    expect(within(paneEl('editor-2')).getByLabelText('não salvo')).toBeTruthy();
  });

  it('saving on either side writes once and clears the mark on both', async () => {
    const { api, left, paneEl } = await splitSetup();
    act(() => {
      left.dispatch({ changes: { from: 0, insert: 'x' } });
    });
    await waitFor(() => expect(within(paneEl('editor-2')).getByLabelText('não salvo')).toBeTruthy());
    await act(async () => {
      fireEvent.click(within(paneEl('editor-2')).getByRole('button', { name: 'Salvar' }));
    });
    expect(api.files.write).toHaveBeenCalledTimes(1);
    expect(api.files.write).toHaveBeenCalledWith(PATH, 'xlinha um\nlinha dois', 'a'.repeat(64));
    await waitFor(() => expect(screen.queryAllByLabelText('não salvo')).toHaveLength(0));
  });

  it('shows a save conflict once, in the pane that saved', async () => {
    const { api, left, paneEl } = await splitSetup();
    api.files.write.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'FILE_CONFLICT' as const, message: 'O arquivo mudou no disco desde que foi aberto.' },
      }),
    );
    act(() => {
      left.dispatch({ changes: { from: 0, insert: 'x' } });
    });
    await waitFor(() => expect(within(paneEl('editor-1')).getByLabelText('não salvo')).toBeTruthy());
    await act(async () => {
      fireEvent.click(within(paneEl('editor-1')).getByRole('button', { name: 'Salvar' }));
    });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(paneEl('editor-1')).getByRole('alert').textContent).toContain('mudou no disco');
  });

  it('closing one side keeps the unsaved text on the other', async () => {
    const { left, right, session } = await splitSetup();
    act(() => {
      left.dispatch({ changes: { from: 0, insert: 'x' } });
    });
    await waitFor(() => expect(session.drafts.snapshot()[PATH]?.dirty).toBe(true));
    expect(session.panes.holds(PATH, 'editor-1')).toBe(true);
    expect(right.state.doc.toString().startsWith('x')).toBe(true);
  });
});
