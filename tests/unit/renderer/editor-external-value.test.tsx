import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CodeEditor } from '../../../src/renderer/components/Editor/CodeEditor';

describe('editor programmatic draft updates', () => {
  it('updates mounted CodeMirror views after a confirmed external reload or semantic edit', () => {
    const props = { path: '/repo/a.ts', onChange: vi.fn(), onSave: vi.fn() };
    const view = render(<CodeEditor {...props} value="before" />);
    expect(screen.getByTestId('code-editor').querySelector('.cm-content')?.textContent).toBe('before');
    view.rerender(<CodeEditor {...props} value="after" />);
    expect(screen.getByTestId('code-editor').querySelector('.cm-content')?.textContent).toBe('after');
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
