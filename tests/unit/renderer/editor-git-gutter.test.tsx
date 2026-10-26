import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { CodeEditor } from '../../../src/renderer/components/Editor/CodeEditor';
import {
  changeAtLine,
  GIT_DIFF_DELAY_MS,
  GIT_GUTTER_MAX_CHARS,
  gitGutter,
  gitGutterState,
  revertChange,
  setGitBase,
} from '../../../src/renderer/components/Editor/extensions/git-gutter';
import { useGitBase } from '../../../src/renderer/components/Editor/use-git-base';
import { GitWorkspaceProvider } from '../../../src/renderer/git/git-workspace';
import type { Group } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from '../../support/fake-api';

const BASE = ['um', 'dois', 'tres', 'quatro'].join('\n');

function view(doc: string, onOpen = vi.fn()) {
  return new EditorView({
    state: EditorState.create({ doc, extensions: [gitGutter({ onOpen })] }),
    parent: document.body,
  });
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('git gutter — marcas', () => {
  it('computes the marks right after the base arrives', () => {
    vi.useFakeTimers();
    const v = view(['UM', 'dois', 'tres', 'quatro', 'cinco'].join('\n'));
    v.dispatch({ effects: setGitBase.of(BASE) });
    vi.advanceTimersByTime(0);
    expect(v.state.field(gitGutterState).changes).toEqual([
      { fromLine: 1, toLine: 1, kind: 'modified', original: 'um' },
      { fromLine: 5, toLine: 5, kind: 'added', original: '' },
    ]);
    v.destroy();
  });

  it('draws one mark per changed line with an aria-label per kind', () => {
    vi.useFakeTimers();
    const v = view(['UM', 'tres', 'quatro', 'novo'].join('\n'));
    v.dispatch({ effects: setGitBase.of(BASE) });
    vi.advanceTimersByTime(0);
    const labels = [...v.dom.querySelectorAll('.cm-git-gutter .git-mark')].map((m) =>
      m.getAttribute('aria-label'),
    );
    expect(labels).toContain('Linhas alteradas');
    expect(labels).toContain('Linhas adicionadas');
    v.destroy();
    const removed = view(['um', 'quatro'].join('\n'));
    removed.dispatch({ effects: setGitBase.of(BASE) });
    vi.advanceTimersByTime(0);
    const kinds = [...removed.dom.querySelectorAll('.cm-git-gutter .git-mark')].map((m) =>
      m.getAttribute('aria-label'),
    );
    expect(kinds).toEqual(['Linhas removidas']);
    removed.destroy();
  });

  it('updates the marks 150 ms after an edit, not before', () => {
    vi.useFakeTimers();
    const v = view(BASE);
    v.dispatch({ effects: setGitBase.of(BASE) });
    vi.advanceTimersByTime(0);
    expect(v.state.field(gitGutterState).changes).toEqual([]);
    v.dispatch({ changes: { from: 0, to: 2, insert: 'UM' } });
    vi.advanceTimersByTime(GIT_DIFF_DELAY_MS - 1);
    expect(v.state.field(gitGutterState).changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(v.state.field(gitGutterState).changes).toEqual([
      { fromLine: 1, toLine: 1, kind: 'modified', original: 'um' },
    ]);
    v.destroy();
  });

  it('has no marks without a base (outside git, untracked or binary)', () => {
    vi.useFakeTimers();
    const v = view('qualquer');
    v.dispatch({ effects: setGitBase.of(null) });
    vi.advanceTimersByTime(GIT_DIFF_DELAY_MS);
    expect(v.state.field(gitGutterState).changes).toEqual([]);
    expect(v.dom.querySelectorAll('.git-mark')).toHaveLength(0);
    v.destroy();
  });

  it('turns itself off for a file over 2 MB', () => {
    vi.useFakeTimers();
    const v = view('x'.repeat(GIT_GUTTER_MAX_CHARS + 1));
    v.dispatch({ effects: setGitBase.of('y') });
    vi.advanceTimersByTime(0);
    expect(v.state.field(gitGutterState).changes).toBe('off');
    v.destroy();
  });

  it('finds the change of a line', () => {
    const changes = [{ fromLine: 2, toLine: 4, kind: 'modified' as const, original: 'x' }];
    expect(changeAtLine(changes, 3)).toBe(changes[0]);
    expect(changeAtLine(changes, 5)).toBeUndefined();
    expect(changeAtLine('off', 1)).toBeUndefined();
  });
});

describe('git gutter — reverter trecho', () => {
  function revertAll(base: string, current: string): string {
    vi.useFakeTimers();
    const v = view(current);
    v.dispatch({ effects: setGitBase.of(base) });
    vi.advanceTimersByTime(0);
    for (;;) {
      const changes = v.state.field(gitGutterState).changes;
      if (changes === 'off' || changes.length === 0) break;
      revertChange(v, changes[0]!);
      vi.advanceTimersByTime(GIT_DIFF_DELAY_MS);
    }
    const text = v.state.doc.toString();
    v.destroy();
    return text;
  }

  it('reverts a modified, an added and a removed block back to the committed text', () => {
    expect(revertAll(BASE, ['UM', 'dois', 'tres', 'quatro'].join('\n'))).toBe(BASE);
    expect(revertAll(BASE, ['um', 'dois', 'extra', 'tres', 'quatro'].join('\n'))).toBe(BASE);
    expect(revertAll(BASE, ['um', 'quatro'].join('\n'))).toBe(BASE);
  });

  it('reverts blocks at the start and at the end of the file', () => {
    expect(revertAll(BASE, ['zero', 'um', 'dois', 'tres', 'quatro'].join('\n'))).toBe(BASE);
    expect(revertAll(BASE, ['um', 'dois', 'tres', 'quatro', 'fim'].join('\n'))).toBe(BASE);
    expect(revertAll(BASE, ['dois', 'tres', 'quatro'].join('\n'))).toBe(BASE);
    expect(revertAll(BASE, ['um', 'dois'].join('\n'))).toBe(BASE);
  });
});

describe('CodeEditor — margem e trecho original', () => {
  it('shows the original of a mark on click and reverts only the tab text', async () => {
    const onChange = vi.fn();
    render(
      <CodeEditor
        path="/ws/a.ts"
        value={['UM', 'dois', 'tres', 'quatro'].join('\n')}
        gitBase={BASE}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    const mark = await waitFor(() => {
      const el = document.querySelector('.cm-git-gutter .git-mark');
      if (!el) throw new Error('sem marca');
      return el as HTMLElement;
    });
    expect(mark.getAttribute('aria-label')).toBe('Linhas alteradas');
    fireEvent.mouseDown(mark);
    const popup = screen.getByRole('dialog', { name: 'Trecho original' });
    expect(popup.querySelector('pre')?.textContent).toBe('um');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Reverter este trecho' }));
    });
    expect(onChange).toHaveBeenLastCalledWith(BASE);
    expect(screen.queryByRole('dialog', { name: 'Trecho original' })).toBeNull();
  });

  it('shows no marks and no error when there is no base', async () => {
    render(
      <CodeEditor path="/ws/novo.ts" value="texto" gitBase={null} onChange={vi.fn()} onSave={vi.fn()} />,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelectorAll('.git-mark')).toHaveLength(0);
    expect(screen.queryByTestId('git-gutter-hint')).toBeNull();
  });

  it('explains why there are no marks on a huge file', async () => {
    render(
      <CodeEditor
        path="/ws/grande.txt"
        value={'x'.repeat(GIT_GUTTER_MAX_CHARS + 1)}
        gitBase="y"
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('git-gutter-hint')).toBeTruthy();
  });
});

describe('useGitBase', () => {
  const group: Group = {
    id: 'g1',
    name: 'W',
    order: 0,
    folders: [{ id: 'f1', path: '/ws/app' }],
    primaryFolderId: 'f1',
  };

  function wrapperFor(api: ReturnType<typeof fakeApi>) {
    return ({ children }: { children: ReactNode }) => (
      <ApiContext.Provider value={api}>
        <GitWorkspaceProvider workspace={group} availability={{}}>
          {children}
        </GitWorkspaceProvider>
      </ApiContext.Provider>
    );
  }

  it('reads the file at HEAD through the folder of the workspace that has it', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() => okR(repoStatus({ root: '/ws' })));
    api.git.fileAtHead.mockImplementation(() => okR({ text: 'commitado' }));
    const { result } = renderHook(() => useGitBase('/ws/app/src/a.ts'), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current).toBe('commitado'));
    expect(api.git.fileAtHead).toHaveBeenCalledWith('/ws/app', '/ws/app/src/a.ts');
  });

  it('is null for an untracked file', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() => okR(repoStatus()));
    api.git.fileAtHead.mockImplementation(() => okR({ missing: true as const }));
    const { result } = renderHook(() => useGitBase('/ws/app/novo.ts'), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(api.git.fileAtHead).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('does not ask outside git and stays null without error', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() =>
      Promise.resolve({ ok: false as const, error: { code: 'REPO_INVALID' as const, message: 'não é git' } }),
    );
    const { result } = renderHook(() => useGitBase('/ws/app/a.ts'), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(api.git.status).toHaveBeenCalled());
    expect(api.git.fileAtHead).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('does not ask for a file outside the folders of the workspace', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() => okR(repoStatus()));
    renderHook(() => useGitBase('/outro/a.ts'), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(api.git.status).toHaveBeenCalled());
    expect(api.git.fileAtHead).not.toHaveBeenCalled();
  });

  it('reads HEAD again when the window gets the focus back', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() => okR(repoStatus()));
    api.git.fileAtHead.mockImplementation(() => okR({ text: 'v1' }));
    const { result } = renderHook(() => useGitBase('/ws/app/a.ts'), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current).toBe('v1'));
    api.git.fileAtHead.mockImplementation(() => okR({ text: 'v2' }));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(result.current).toBe('v2'));
  });

  it('reads HEAD again when the head of the repository changes (a commit)', async () => {
    const api = fakeApi();
    let head = 'a'.repeat(40);
    api.git.status.mockImplementation(() => okR(repoStatus({ head })));
    api.git.fileAtHead.mockImplementation(() => okR({ text: `base ${head.slice(0, 1)}` }));
    const { result } = renderHook(() => useGitBase('/ws/app/a.ts'), { wrapper: wrapperFor(api) });
    await waitFor(() => expect(result.current).toBe('base a'));
    head = 'b'.repeat(40);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(result.current).toBe('base b'));
  });
});
