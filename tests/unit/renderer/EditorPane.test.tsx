import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import type { CodeEditorProps } from '../../../src/renderer/components/Editor/CodeEditor';
import { EditorPane } from '../../../src/renderer/components/Editor/EditorPane';
import type { Pane } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const PANE: Extract<Pane, { kind: 'editor' }> = {
  id: 'editor-1',
  kind: 'editor',
  docs: ['/ws/a.ts', '/ws/b.ts'],
  activeIndex: 0,
};

function FakeEditor({ path, value, onChange, onSave }: CodeEditorProps) {
  return (
    <div>
      <textarea
        aria-label={`editor-${path}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" onClick={onSave}>
        salvar-interno
      </button>
    </div>
  );
}

function setup(
  over: Partial<Parameters<typeof EditorPane>[0]> = {},
  configure?: (api: ReturnType<typeof fakeApi>) => void,
) {
  const api = fakeApi();
  configure?.(api);
  const onSelect = vi.fn();
  const onCloseTab = vi.fn();
  const onFocus = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <EditorPane
        pane={PANE}
        focused
        onFocus={onFocus}
        onSelect={onSelect}
        onCloseTab={onCloseTab}
        renderEditor={(props) => <FakeEditor {...props} />}
        {...over}
      />
    </ApiContext.Provider>,
  );
  return { api, onSelect, onCloseTab, onFocus };
}

describe('EditorPane', () => {
  it('loads the active document and shows a tab per file', async () => {
    const { api } = setup();
    expect(await screen.findByLabelText('editor-/ws/a.ts')).toBeTruthy();
    expect(api.files.read.mock.calls[0]?.[0]).toBe('/ws/a.ts');
    expect(screen.getByRole('tab', { name: 'a.ts' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'b.ts' })).toBeTruthy();
  });

  it('marks the tab dirty, saves with the read hash and clears the mark', async () => {
    const { api } = setup();
    const editor = await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.change(editor, { target: { value: 'novo texto' } });
    expect(screen.getByLabelText('não salvo')).toBeTruthy();
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(api.files.write).toHaveBeenCalledTimes(1));
    expect(api.files.write.mock.calls[0]).toEqual(['/ws/a.ts', 'novo texto', 'a'.repeat(64)]);
    await waitFor(() => expect(screen.queryByLabelText('não salvo')).toBeNull());
  });

  it('keeps the mark and shows the message when the file changed on disk', async () => {
    const { api } = setup();
    api.files.write.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'FILE_CONFLICT' as const, message: 'O arquivo mudou no disco desde que foi aberto.' },
      }),
    );
    const editor = await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.change(editor, { target: { value: 'x' } });
    fireEvent.click(screen.getByText('Salvar'));
    expect(await screen.findByText(/mudou no disco/)).toBeTruthy();
    expect(screen.getByLabelText('não salvo')).toBeTruthy();
  });

  it('asks before closing a dirty tab and keeps it when the user refuses', async () => {
    const { onCloseTab } = setup();
    const editor = await screen.findByLabelText('editor-/ws/a.ts');
    fireEvent.change(editor, { target: { value: 'x' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByLabelText('Fechar a.ts'));
    expect(confirm).toHaveBeenCalled();
    expect(onCloseTab).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByLabelText('Fechar a.ts'));
    expect(onCloseTab).toHaveBeenCalledWith('/ws/a.ts');
    confirm.mockRestore();
  });

  it('selects another tab when the user clicks it', async () => {
    const { onSelect } = setup();
    fireEvent.click(await screen.findByRole('tab', { name: 'b.ts' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('explains a binary file instead of rendering it', async () => {
    setup({}, (api) => {
      api.files.read.mockImplementation(() =>
        okR({ path: '/ws/a.ts', content: '', size: 10, binary: true, truncated: false, hash: 'c'.repeat(64) }),
      );
    });
    expect(await screen.findByText(/binário e não abre/)).toBeTruthy();
  });
});
