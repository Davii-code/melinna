import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers, showTooltip } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import {
  ideEditorExtensions,
  registerIdeView,
  setCompletionProvider,
} from '../../../src/renderer/components/Ide/editor-tools';

describe('semantic completion popup', () => {
  it('only applies the suggestion selected explicitly by the user', async () => {
    const apply = vi.fn(async () => undefined);
    const stopProvider = setCompletionProvider(async () => [{ label: 'hello', apply }]);
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: 'hel', extensions: ideEditorExtensions('/repo/a.ts') }),
    });
    const unregister = registerIdeView('/repo/a.ts', view);
    try {
      runScopeHandlers(
        view,
        new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true }),
        'editor',
      );
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(apply).not.toHaveBeenCalled();
      const tooltip = view.state.facet(showTooltip).find((value) => value !== null)!;
      const element = tooltip.create(view).dom;
      expect(element.getAttribute('role')).toBe('listbox');
      (element.querySelector('button') as HTMLButtonElement).click();
      expect(apply).toHaveBeenCalledOnce();
    } finally {
      unregister();
      stopProvider();
      view.destroy();
    }
  });
});
