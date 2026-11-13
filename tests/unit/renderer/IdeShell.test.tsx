import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { IdeTools } from '../../../src/renderer/components/Ide/IdeTools';
import { createEditorSession } from '../../../src/renderer/components/Editor/editor-session';
import { fakeApi } from '../../support/fake-api';

describe('IDE shell', () => {
  it('preserves tool input across tabs and collapse and supports keyboard resize', () => {
    localStorage.clear();
    const api = fakeApi();
    const editor = createEditorSession();
    editor.drafts.set('/repo/a.ts', { text: 'unsaved', baseHash: 'h', dirty: true });
    render(
      <ApiContext.Provider value={api}>
        <IdeTools roots={[]} editor={editor} onOpen={vi.fn()} onRun={vi.fn()} />
      </ApiContext.Provider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://example.test' } });
    const separator = screen.getByRole('separator', { name: 'Altura das ferramentas' });
    fireEvent.keyDown(separator, { key: 'ArrowUp' });
    expect(separator.getAttribute('aria-valuenow')).toBe('300');
    fireEvent.click(screen.getByRole('button', { name: 'Recolher ferramentas IDE' }));
    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    expect((screen.getByLabelText('URL') as HTMLInputElement).value).toBe('https://example.test');
    expect(api.ide.httpSend).not.toHaveBeenCalled();
    expect(api.ide.start).not.toHaveBeenCalled();
    expect(editor.drafts.snapshot()['/repo/a.ts']).toEqual({ text: 'unsaved', baseHash: 'h', dirty: true });
  });
});
