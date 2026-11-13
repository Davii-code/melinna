import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { LanguageTools } from '../../../src/renderer/components/Ide/LanguageTools';
import { createEditorSession } from '../../../src/renderer/components/Editor/editor-session';
import { fakeApi, okR } from '../../support/fake-api';
vi.mock('../../../src/renderer/components/Ide/editor-tools', () => ({
  editorContext: () => ({ path: '/repo/a.ts', text: 'old', offset: 0, position: { line: 0, character: 0 } }),
  setHoverProvider: () => () => undefined,
  setCompletionProvider: () => () => undefined,
  setIdeDiagnostics: vi.fn(),
}));

describe('language tools', () => {
  it('ignores diagnostics for stale versions and navigates current diagnostics', async () => {
    const api = fakeApi(),
      editor = createEditorSession(),
      onOpen = vi.fn();
    editor.drafts.set('/repo/a.ts', { text: 'old', baseHash: 'a'.repeat(64), dirty: false });
    render(
      <ApiContext.Provider value={api}>
        <LanguageTools
          roots={[{ path: '/repo', kind: 'workspace', label: 'Repo' }]}
          editor={editor}
          onOpen={onOpen}
        />
      </ApiContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText('Executável do servidor LSP'), { target: { value: 'server' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar servidor LSP' }));
    await waitFor(() => expect(api.ide.notify).toHaveBeenCalled());
    const diagnostic = {
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      message: 'current problem',
      severity: 1,
    };
    const send = (version: number) =>
      api.emitIdeEvent({
        sessionId: 'ide-1',
        protocol: 'lsp',
        message: {
          method: 'textDocument/publishDiagnostics',
          params: { uri: 'file:///repo/a.ts', version, diagnostics: [diagnostic] },
        },
      });
    act(() => send(0));
    expect(screen.queryByRole('button', { name: /current problem/ })).toBeNull();
    act(() => send(1));
    fireEvent.click(await screen.findByRole('button', { name: /current problem/ }));
    expect(onOpen).toHaveBeenCalledWith('/repo/a.ts', { line: 0, character: 0 });
  });
  it('previews rename and applies only to drafts after confirmation', async () => {
    const api = fakeApi();
    const editor = createEditorSession();
    editor.drafts.set('/repo/a.ts', { text: 'old', baseHash: 'a'.repeat(64), dirty: false });
    api.files.read.mockResolvedValue(
      okR({
        path: '/repo/a.ts',
        content: 'old',
        hash: 'a'.repeat(64),
        size: 3,
        binary: false,
        truncated: false,
      }),
    );
    api.ide.call.mockResolvedValue(
      okR({
        changes: {
          'file:///repo/a.ts': [
            { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'new' },
          ],
        },
      }),
    );
    render(
      <ApiContext.Provider value={api}>
        <LanguageTools
          roots={[{ path: '/repo', label: 'Repo', kind: 'workspace' }]}
          editor={editor}
          onOpen={() => undefined}
        />
      </ApiContext.Provider>,
    );
    fireEvent.change(screen.getByLabelText('Executável do servidor LSP'), { target: { value: 'server' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar servidor LSP' }));
    await waitFor(() =>
      expect(api.ide.notify).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'textDocument/didOpen' }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Novo nome'), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Renomear símbolo' }));
    expect(await screen.findByRole('region', { name: 'Prévia da alteração' })).toBeTruthy();
    expect(editor.drafts.snapshot()['/repo/a.ts']?.text).toBe('old');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar aos rascunhos' }));
    await waitFor(() =>
      expect(editor.drafts.snapshot()['/repo/a.ts']).toMatchObject({ text: 'new', dirty: true }),
    );
    expect(api.files.write).not.toHaveBeenCalled();
  });
});
