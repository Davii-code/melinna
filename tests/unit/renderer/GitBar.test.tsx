import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { GitBar } from '../../../src/renderer/components/Git/GitBar';
import { Tree } from '../../../src/renderer/components/Tree/Tree';
import type { Group, RepoStatus, Result } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from '../../support/fake-api';
import { execution } from '../../support/renderer-fixtures';

type Api = ReturnType<typeof fakeApi>;

function setup(status: Partial<RepoStatus> = {}, props: { liveAgents?: number } = {}) {
  const api = fakeApi();
  api.git.status.mockImplementation(() => okR(repoStatus(status)));
  const onOpenFile = vi.fn();
  const view = render(
    <ApiContext.Provider value={api}>
      <GitBar repo="/repo" title="site" liveAgents={props.liveAgents ?? 0} onOpenFile={onOpenFile} />
    </ApiContext.Provider>,
  );
  return { api, onOpenFile, ...view };
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

async function ready() {
  await screen.findByRole('button', { name: 'Fetch' });
}

const error = (code: 'GIT_AUTH' | 'GIT_REJECTED', message: string): Promise<Result<never>> =>
  Promise.resolve({ ok: false, error: { code, message } });

describe('GitBar', () => {
  it('shows the branch, ahead/behind and the time of the last fetch', async () => {
    const fetched = new Date(Date.now() - 5 * 60_000).toISOString();
    setup({ branch: 'feature/x', ahead: 2, behind: 3, lastFetchAt: fetched });
    await ready();
    expect(screen.getByRole('button', { name: /Branch feature\/x/ })).toBeTruthy();
    expect(screen.getByText('↑2')).toBeTruthy();
    expect(screen.getByText('↓3')).toBeTruthy();
    expect(screen.getByText(/fetch há 5 min/)).toBeTruthy();
  });

  it('shows no ahead/behind without an upstream and says it never fetched', async () => {
    setup({ upstream: null, ahead: null, behind: null, lastFetchAt: null });
    await ready();
    expect(screen.queryByText(/↑/)).toBeNull();
    expect(screen.queryByText(/↓/)).toBeNull();
    expect(screen.getByText(/fetch nunca/)).toBeTruthy();
  });

  it('shows the repository state', async () => {
    const { unmount } = setup({ state: 'merging' });
    expect(await screen.findByText(/Merge em andamento/)).toBeTruthy();
    unmount();
    const rebase = setup({ state: 'rebasing' });
    expect(await screen.findByText(/Rebase em andamento.*conclua fora do app/)).toBeTruthy();
    rebase.unmount();
    const pick = setup({ state: 'cherry-picking' });
    expect(await screen.findByText(/Cherry-pick em andamento.*conclua fora do app/)).toBeTruthy();
    pick.unmount();
    setup({ state: 'detached', branch: null, head: 'abcdef1234567890', upstream: null, ahead: null, behind: null });
    expect(await screen.findByText(/HEAD solto em abcdef1/)).toBeTruthy();
    expect(button('Push').disabled).toBe(true);
    expect(button('Pull').disabled).toBe(true);
  });

  it('renders nothing for a folder that is not a git repository', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() =>
      Promise.resolve({ ok: false as const, error: { code: 'REPO_INVALID' as const, message: 'não é git' } }),
    );
    const { container } = render(
      <ApiContext.Provider value={api}>
        <GitBar repo="/sem-git" title="x" liveAgents={0} onOpenFile={vi.fn()} />
      </ApiContext.Provider>,
    );
    await waitFor(() => expect(api.git.status).toHaveBeenCalled());
    expect(container.querySelector('.git-bar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fetch' })).toBeNull();
  });

  it('disables the network buttons without a remote and explains why', async () => {
    setup({ hasRemote: false, upstream: null, ahead: null, behind: null, defaultRemoteBranch: null });
    await ready();
    for (const name of ['Fetch', 'Pull', 'Push']) {
      expect(button(name).disabled).toBe(true);
      expect(button(name).title).toMatch(/sem remoto/i);
    }
    expect(screen.getByText(/Sem remoto configurado/)).toBeTruthy();
    expect(button('Commit').disabled).toBe(false);
  });

  it('runs a fetch with progress and cancel, then rereads the status', async () => {
    const { api } = setup();
    await ready();
    fireEvent.click(button('Fetch'));
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalledWith('/repo'));
    act(() => api.emitGitProgress({ opId: 'op-fetch', phase: 'Recebendo objetos', percent: 40 }));
    expect(await screen.findByText(/Recebendo objetos/)).toBeTruthy();
    const bar = screen.getByRole('progressbar') as HTMLProgressElement;
    expect(bar.value).toBe(40);
    expect(button('Pull').disabled).toBe(true);
    fireEvent.click(button('Cancelar'));
    await waitFor(() => expect(api.git.cancel).toHaveBeenCalledWith('op-fetch'));
    const callsBefore = api.git.status.mock.calls.length;
    act(() => api.emitGitProgress({ opId: 'op-fetch', phase: 'fetch', done: true }));
    await waitFor(() => expect(api.git.status.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(button('Pull').disabled).toBe(false);
  });

  it('handles an end event that arrives before the opId is known', async () => {
    const { api } = setup();
    api.git.fetch.mockImplementation(async () => {
      api.emitGitProgress({ opId: 'op-rapido', phase: 'fetch', done: true });
      return { ok: true as const, value: { opId: 'op-rapido' } };
    });
    await ready();
    fireEvent.click(button('Fetch'));
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalled());
    await waitFor(() => expect(button('Fetch').disabled).toBe(false));
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the error of a failed operation, including the authentication guidance', async () => {
    const { api } = setup();
    await ready();
    fireEvent.click(button('Fetch'));
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalled());
    act(() =>
      api.emitGitProgress({
        opId: 'op-fetch',
        phase: 'fetch',
        done: true,
        error: {
          code: 'GIT_AUTH',
          message: 'O git não conseguiu se autenticar no remoto. Configure suas credenciais (Git Credential Manager ou SSH) e tente de novo.',
        },
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/Git Credential Manager ou SSH/);
  });

  it('shows an immediate error from starting the push', async () => {
    const { api } = setup();
    api.git.push.mockImplementation(() => error('GIT_REJECTED', 'O remoto recusou o envio.'));
    await ready();
    fireEvent.click(button('Push'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/O remoto recusou o envio/);
  });

  it('asks to confirm a push to the main branch and repeats with the confirmation', async () => {
    const { api } = setup();
    api.git.push.mockImplementationOnce(() =>
      okR({ needsConfirm: 'push-main' as const, details: { branch: 'main', remote: 'origin' } }),
    );
    await ready();
    fireEvent.click(button('Push'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('main')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.git.push).toHaveBeenCalledTimes(2));
    expect(api.git.push).toHaveBeenLastCalledWith('/repo', ['push-main']);
  });

  it('accumulates confirmations: set-upstream and then push-main', async () => {
    const { api } = setup({ upstream: null, ahead: null, behind: null });
    api.git.push
      .mockImplementationOnce(() => okR({ needsConfirm: 'set-upstream' as const, details: { branch: 'main', remote: 'origin' } }))
      .mockImplementationOnce(() => okR({ needsConfirm: 'push-main' as const, details: { branch: 'main', remote: 'origin' } }));
    await ready();
    fireEvent.click(button('Push'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.git.push).toHaveBeenCalledTimes(3));
    expect(api.git.push).toHaveBeenLastCalledWith('/repo', ['set-upstream', 'push-main']);
  });

  it('asks to confirm a pull with local changes', async () => {
    const { api } = setup({ behind: 1 });
    api.git.pull.mockImplementationOnce(() =>
      okR({ needsConfirm: 'merge-dirty' as const, details: { files: [{ path: 'a.txt' }] } }),
    );
    await ready();
    fireEvent.click(button('Pull'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('a.txt')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(api.git.pull).toHaveBeenLastCalledWith('/repo', ['merge-dirty']));
  });

  it('keeps everything untouched when a confirmation is cancelled', async () => {
    const { api } = setup();
    api.git.push.mockImplementationOnce(() =>
      okR({ needsConfirm: 'push-main' as const, details: { branch: 'main', remote: 'origin' } }),
    );
    await ready();
    fireEvent.click(button('Push'));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.git.push).toHaveBeenCalledTimes(1);
  });

  it('offers the conflict list when a pull ends with conflicts', async () => {
    const { api } = setup();
    await ready();
    fireEvent.click(button('Pull'));
    await waitFor(() => expect(api.git.pull).toHaveBeenCalledWith('/repo'));
    api.git.status.mockImplementation(() =>
      okR(
        repoStatus({
          state: 'merging',
          changes: [{ path: 'a.txt', kind: 'conflict', indexChanged: true, worktreeChanged: true }],
        }),
      ),
    );
    act(() =>
      api.emitGitProgress({ opId: 'op-pull', phase: 'pull', done: true, result: { conflicts: ['a.txt'] } }),
    );
    expect(await screen.findByText(/Pull terminou com conflitos/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resolver conflitos' })).toBeTruthy();
  });

  it('rereads the status when the window regains focus', async () => {
    const { api } = setup();
    await ready();
    const before = api.git.status.mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.git.status.mock.calls.length).toBe(before + 1));
  });

  it('opens the commit window with the number of live agents', async () => {
    setup({}, { liveAgents: 2 });
    await ready();
    fireEvent.click(button('Commit'));
    expect(await screen.findByRole('dialog', { name: /Commit: site/ })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toMatch(/2 agentes/);
  });
});

describe('Tree git bars', () => {
  const group: Group = {
    id: 'g1',
    name: 'Meu workspace',
    order: 0,
    repoPath: '/repos/a',
    primaryFolderId: 'f1',
    folders: [
      { id: 'f1', path: '/repos/a' },
      { id: 'f2', path: '/repos/b' },
      { id: 'f3', path: '/repos/sem-git' },
    ],
  };

  function renderTree(api: Api) {
    api.git.status.mockImplementation((repo: string) =>
      repo === '/repos/sem-git'
        ? Promise.resolve({ ok: false as const, error: { code: 'REPO_INVALID' as const, message: 'não é git' } })
        : okR(repoStatus({ root: repo, branch: repo === '/repos/a' ? 'main' : 'dev' })),
    );
    render(
      <ApiContext.Provider value={api}>
        <Tree
          groups={[group]}
          tasks={[
            {
              id: 't1',
              groupId: 'g1',
              title: 'Sessão',
              prompt: '',
              repoPath: '/repos/a',
              repoId: 'r',
              baseRef: 'HEAD',
              baseCommit: '',
              slug: 's',
              createdAt: '2026-10-22T10:00:00.000Z',
            },
          ]}
          executions={[execution('e1', { taskId: 't1', status: 'running' }), execution('e2', { taskId: 't1', status: 'exited' })]}
          agents={new Map()}
          openIds={[]}
          onOpen={vi.fn()}
          onStop={vi.fn()}
          onRelaunch={vi.fn()}
          onRemove={vi.fn()}
          onRenameGroup={vi.fn()}
          onRenameTask={vi.fn()}
          onRemoveTask={vi.fn()}
          onRemoveGroup={vi.fn()}
          onOpenFile={vi.fn()}
        />
      </ApiContext.Provider>,
    );
  }

  it('shows one bar per git folder and none for a folder without git', async () => {
    const api = fakeApi();
    renderTree(api);
    expect(await screen.findByRole('button', { name: /Branch main/ })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Branch dev/ })).toBeTruthy();
    await waitFor(() => expect(api.git.status).toHaveBeenCalledWith('/repos/sem-git'));
    expect(screen.getAllByRole('group', { name: /^Git de / })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Fetch' })).toHaveLength(2);
  });

  it('passes the number of live agents of the workspace to the commit window', async () => {
    const api = fakeApi();
    renderTree(api);
    const bars = await screen.findAllByRole('group', { name: /^Git de / });
    fireEvent.click(within(bars[0]!).getByRole('button', { name: 'Commit' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/1 agente /);
  });
});
