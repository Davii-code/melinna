import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ConflictList } from '../../../src/renderer/components/Git/ConflictList';
import { GitBar } from '../../../src/renderer/components/Git/GitBar';
import type { Change } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from '../../support/fake-api';

const conflict = (path: string): Change => ({ path, kind: 'conflict', indexChanged: true, worktreeChanged: true });

function setup(changes: Change[] = [conflict('src/a.ts'), conflict('b.md')]) {
  const api = fakeApi();
  api.git.status.mockImplementation(() =>
    okR(repoStatus({ root: '/repo', state: 'merging', mergeMessage: "Merge branch 'feature'", changes })),
  );
  const onOpenFile = vi.fn();
  const onClose = vi.fn();
  const onConclude = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <ConflictList repo="/repo" onOpenFile={onOpenFile} onClose={onClose} onConclude={onConclude} />
    </ApiContext.Provider>,
  );
  return { api, onOpenFile, onClose, onConclude };
}

describe('ConflictList', () => {
  it('lists only the files in conflict', async () => {
    setup([conflict('src/a.ts'), { path: 'ok.txt', kind: 'modified', indexChanged: true, worktreeChanged: false }]);
    expect(await screen.findByText('src/a.ts')).toBeTruthy();
    expect(screen.queryByText('ok.txt')).toBeNull();
  });

  it('opens a conflicting file in the app editor with its absolute path', async () => {
    const { onOpenFile } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir src/a.ts no editor' }));
    expect(onOpenFile).toHaveBeenCalledWith('/repo/src/a.ts');
  });

  it('marks a file as resolved and rereads the list', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar src/a.ts como resolvido' }));
    await waitFor(() => expect(api.git.markResolved).toHaveBeenCalledWith('/repo', ['src/a.ts']));
    await waitFor(() => expect(api.git.status.mock.calls.length).toBeGreaterThan(1));
  });

  it('only allows concluding when no conflict is left', async () => {
    const { api, onConclude } = setup();
    const conclude = await screen.findByRole('button', { name: 'Concluir merge' });
    expect((conclude as HTMLButtonElement).disabled).toBe(true);
    api.git.status.mockImplementation(() =>
      okR(repoStatus({ state: 'merging', mergeMessage: "Merge branch 'feature'", changes: [] })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Marcar b.md como resolvido' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Concluir merge' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Concluir merge' }));
    expect(onConclude).toHaveBeenCalled();
  });

  it('aborts the merge only after confirming', async () => {
    const { api, onClose } = setup();
    api.git.abortMerge.mockImplementationOnce(() => okR({ needsConfirm: 'abort-merge' as const, details: {} }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abortar merge' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/resoluções feitas até agora serão descartadas/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abortar merge' }));
    await waitFor(() => expect(api.git.abortMerge).toHaveBeenLastCalledWith('/repo', ['abort-merge']));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the merge when the abort confirmation is cancelled', async () => {
    const { api, onClose } = setup();
    api.git.abortMerge.mockImplementationOnce(() => okR({ needsConfirm: 'abort-merge' as const, details: {} }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abortar merge' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(api.git.abortMerge).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses backslashes for Windows roots', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() =>
      okR(repoStatus({ root: 'C:\\ws\\repo', state: 'merging', changes: [conflict('src/a.ts')] })),
    );
    const onOpenFile = vi.fn();
    render(
      <ApiContext.Provider value={api}>
        <ConflictList repo={'C:\\ws\\repo'} onOpenFile={onOpenFile} onClose={vi.fn()} onConclude={vi.fn()} />
      </ApiContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir src/a.ts no editor' }));
    expect(onOpenFile).toHaveBeenCalledWith('C:\\ws\\repo\\src\\a.ts');
  });
});

describe('concluding a merge from the git bar', () => {
  it('opens the commit window with the merge message', async () => {
    const api = fakeApi();
    let changes: Change[] = [conflict('a.txt')];
    api.git.status.mockImplementation(() =>
      okR(repoStatus({ root: '/repo', state: 'merging', mergeMessage: "Merge branch 'feature'", changes })),
    );
    render(
      <ApiContext.Provider value={api}>
        <GitBar repo="/repo" title="site" liveAgents={0} onOpenFile={vi.fn()} />
      </ApiContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Resolver conflitos' }));
    changes = [];
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar a.txt como resolvido' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Concluir merge' }) as HTMLButtonElement).disabled).toBe(false));
    changes = [{ path: 'a.txt', kind: 'modified', indexChanged: true, worktreeChanged: false }];
    fireEvent.click(screen.getByRole('button', { name: 'Concluir merge' }));
    const message = await screen.findByLabelText('Mensagem do commit');
    await waitFor(() => expect((message as HTMLTextAreaElement).value).toBe("Merge branch 'feature'"));
  });
});
