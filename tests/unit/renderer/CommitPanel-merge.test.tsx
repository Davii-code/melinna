import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitPanel } from '../../../src/renderer/components/Git/CommitPanel';
import { fakeApi, okR } from '../../support/fake-api';
import { change, renderWithGit } from '../../support/git-render';

const merging = {
  state: 'merging' as const,
  branch: 'main',
  mergeMessage: "Merge branch 'dev'",
  changes: [change('src/c.ts', 'conflict'), change('ok.ts')],
};

function setup(statuses: Record<string, object> = { '/m': merging }, roots = ['/m']) {
  const onOpenFile = vi.fn();
  const api = fakeApi();
  const view = renderWithGit(<CommitPanel liveAgents={0} onOpenFile={onOpenFile} onShowDiff={vi.fn()} />, {
    api,
    roots,
    statuses: statuses as never,
  });
  return { api, onOpenFile, ...view };
}

describe('CommitPanel during a merge', () => {
  it('shows the merge in progress and the conflicts', async () => {
    setup();
    expect(await screen.findByText(/merge em andamento/i)).toBeTruthy();
    const section = screen.getByRole('region', { name: 'Conflitos de m' });
    expect(within(section).getByText('src/c.ts')).toBeTruthy();
    expect(within(section).queryByText('ok.ts')).toBeNull();
  });

  it('opens a conflict in the editor with an absolute path (/ and \\)', async () => {
    const { onOpenFile, unmount } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir src/c.ts no editor' }));
    expect(onOpenFile).toHaveBeenCalledWith('/m/src/c.ts');
    unmount();
    const win = setup({ 'C:\\w\\m': merging }, ['C:\\w\\m']);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir src/c.ts no editor' }));
    expect(win.onOpenFile).toHaveBeenCalledWith('C:\\w\\m\\src\\c.ts');
  });

  it('marks a conflict as resolved and rereads', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar src/c.ts como resolvido' }));
    await waitFor(() => expect(api.git.markResolved).toHaveBeenCalledWith('/m', ['src/c.ts']));
    const calls = api.git.status.mock.calls.length;
    await waitFor(() => expect(api.git.status.mock.calls.length).toBeGreaterThanOrEqual(calls));
    expect(api.git.status.mock.calls.length).toBeGreaterThan(1);
  });

  it('aborts the merge only after the confirmation', async () => {
    const { api } = setup();
    api.git.abortMerge.mockImplementationOnce(() =>
      okR<never>({ needsConfirm: 'abort-merge', details: {} } as never),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Abortar merge' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.git.abortMerge).toHaveBeenCalledTimes(1);
    expect(api.git.abortMerge).toHaveBeenLastCalledWith('/m');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abortar merge' }));
    await waitFor(() => expect(api.git.abortMerge).toHaveBeenCalledTimes(2));
    expect(api.git.abortMerge).toHaveBeenLastCalledWith('/m', ['abort-merge']);
  });

  it('suggests the merge message and requires every file in the commit', async () => {
    const { api } = setup({ '/m': { ...merging, changes: [change('a.ts'), change('b.ts')] } });
    await screen.findByText('a.ts');
    const box = screen.getByLabelText('Mensagem do commit') as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe("Merge branch 'dev'"));
    fireEvent.click(screen.getByLabelText('Selecionar a.ts'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'm: Durante um merge, todos os arquivos entram no commit.',
    );
    expect(api.git.commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Selecionar a.ts'));
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(1));
    expect(api.git.commit.mock.calls[0]?.[1].paths).toEqual(['a.ts', 'b.ts']);
  });

  it('refuses to commit a repo that still has conflicts', async () => {
    const { api } = setup();
    await screen.findByText(/merge em andamento/i);
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'm: Resolva os conflitos antes de concluir o merge.',
    );
    expect(api.git.commit).not.toHaveBeenCalled();
  });
});
