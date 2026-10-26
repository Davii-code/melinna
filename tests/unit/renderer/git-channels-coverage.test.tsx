import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import type { TerminalDeps } from '../../../src/renderer/components/TerminalView';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import { createWorkspaceStore } from '../../../src/renderer/store/workspace-store';
import type { PortReceiver } from '../../../src/renderer/terminal/port-receiver';
import type { TerminalLike } from '../../../src/renderer/terminal/xterm-types';
import type { Branch, Commit } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus, snapshot } from '../../support/fake-api';
import { change } from '../../support/git-render';

class FakeTerm implements TerminalLike {
  cols = 80;
  rows = 24;
  open() {}
  write() {}
  onData() {
    return { dispose: () => undefined };
  }
  onBinary() {
    return { dispose: () => undefined };
  }
  focus() {}
  dispose() {}
  proposeSize() {
    return { cols: 100, rows: 30 };
  }
  fit() {}
  attachCustomKeyEventHandler() {}
  onRendererFallback() {}
  search() {
    return false;
  }
  clearSearch() {}
}

const terminal: TerminalDeps = {
  factory: () => new FakeTerm(),
  receiver: {
    expect: () => ({ take: () => new Promise<MessagePort>(() => undefined), cancel: () => undefined }),
    dispose: () => undefined,
  } as PortReceiver,
  observeResize: () => () => undefined,
};

const BRANCHES: Branch[] = [
  { name: 'main', kind: 'local', current: true, upstream: 'origin/main' },
  { name: 'feature/login', kind: 'local', current: false },
];

const COMMIT: Commit = {
  sha: 'a'.repeat(40),
  shortSha: 'aaaaaaa',
  author: 'Davi',
  email: 'd@x',
  date: '2026-10-22T10:00:00-03:00',
  subject: 'feat: antigo',
  body: '',
  files: [{ path: 'src/old.ts', kind: 'modified' }],
};

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});

const menuItem = async (name: string) => {
  if (!screen.queryByRole('menu', { name: 'Branches e git' })) {
    fireEvent.click(await screen.findByRole('button', { name: /^Branch / }));
  }
  fireEvent.click(await within(screen.getByRole('menu', { name: 'Branches e git' })).findByRole('menuitem', { name }));
};

describe('every git channel is reachable from the new interface', () => {
  it('reaches the 16 git:* channels and the gitProgress event', async () => {
    const api = fakeApi();
    api.workspace.snapshot.mockImplementation(() =>
      okR(snapshot({ groups: [{ id: 'w1', name: 'site', order: 0, repoPath: '/repos/site', colorIndex: 0 }] })),
    );
    api.git.status.mockImplementation((repo: string) =>
      okR(repoStatus({ root: repo, changes: [change('src/x.ts')] })),
    );
    api.git.branches.mockImplementation(() => okR(BRANCHES));
    api.git.log.mockImplementation(() => okR([COMMIT]));
    render(
      <App
        api={api}
        terminal={terminal}
        workspaceStore={createWorkspaceStore(api)}
        layoutStore={createLayoutStore(api)}
      />,
    );

    // status + progresso: o painel Commit lê o repositório e o provedor escuta o evento
    fireEvent.click(await screen.findByRole('button', { name: 'Commit (Alt+0)' }));
    await screen.findByText('x.ts');
    expect(api.git.status).toHaveBeenCalledWith('/repos/site');
    expect(api.git.onProgress).toHaveBeenCalled();

    // diffFile
    fireEvent.click(screen.getByText('x.ts'));
    await screen.findByRole('button', { name: 'Fechar diff' });
    expect(api.git.diffFile).toHaveBeenCalledWith('/repos/site', 'src/x.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Fechar diff' }));

    // commit
    fireEvent.change(screen.getByLabelText('Mensagem do commit'), { target: { value: 'feat: x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(api.git.commit).toHaveBeenCalled());

    // discard
    await waitFor(() => expect((screen.getByRole('button', { name: 'Reverter' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Reverter' }));
    await waitFor(() => expect(api.git.discard).toHaveBeenCalled());

    // branches + createBranch
    await menuItem('Nova branch…');
    fireEvent.change(await screen.findByLabelText('Nome da nova branch'), { target: { value: 'feat/z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
    await waitFor(() => expect(api.git.createBranch).toHaveBeenCalledWith('/repos/site', 'feat/z'));
    expect(api.git.branches).toHaveBeenCalled();

    // checkout e merge
    await menuItem('Trocar para feature/login');
    await waitFor(() => expect(api.git.checkout).toHaveBeenCalled());
    await menuItem('Mesclar feature/login na atual');
    await waitFor(() => expect(api.git.merge).toHaveBeenCalled());

    // fetch + cancel + evento de progresso
    await menuItem('Fetch');
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalled());
    await screen.findByText(/Fetch: Iniciando/);
    act(() => api.emitGitProgress({ opId: 'op-fetch', phase: 'Recebendo', percent: 10 }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(api.git.cancel).toHaveBeenCalledWith('op-fetch');
    act(() => api.emitGitProgress({ opId: 'op-fetch', phase: 'fim', done: true }));
    await waitFor(() => expect(screen.queryByText(/Fetch:/)).toBeNull());

    // pull e push
    await menuItem('Pull');
    await waitFor(() => expect(api.git.pull).toHaveBeenCalled());
    await screen.findByText(/Pull: Iniciando/);
    act(() => api.emitGitProgress({ opId: 'op-pull', phase: 'fim', done: true }));
    await waitFor(() => expect(screen.queryByText(/Pull:/)).toBeNull());
    await menuItem('Push…');
    await waitFor(() => expect(api.git.push).toHaveBeenCalled());
    await screen.findByText(/Push: Iniciando/);
    act(() => api.emitGitProgress({ opId: 'op-push', phase: 'fim', done: true }));
    await waitFor(() => expect(screen.queryByText(/Push:/)).toBeNull());

    // log + commitDiff
    await menuItem('Histórico');
    fireEvent.click(await screen.findByText('feat: antigo'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver diff de src/old.ts' }));
    await waitFor(() => expect(api.git.commitDiff).toHaveBeenCalled());
    expect(api.git.log).toHaveBeenCalledWith('/repos/site', 0);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar histórico' }));

    // markResolved e abortMerge: um merge com conflito aparece no painel
    api.git.status.mockImplementation((repo: string) =>
      okR(
        repoStatus({
          root: repo,
          state: 'merging',
          mergeMessage: 'Merge',
          changes: [change('src/c.ts', 'conflict')],
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar src/c.ts como resolvido' }));
    await waitFor(() => expect(api.git.markResolved).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Abortar merge' }));
    await waitFor(() => expect(api.git.abortMerge).toHaveBeenCalled());

    const channels = [
      'status',
      'diffFile',
      'commit',
      'discard',
      'fetch',
      'pull',
      'push',
      'cancel',
      'branches',
      'createBranch',
      'checkout',
      'merge',
      'abortMerge',
      'markResolved',
      'log',
      'commitDiff',
    ] as const;
    expect(channels).toHaveLength(16);
    for (const name of channels) expect(api.git[name], name).toHaveBeenCalled();
  });
});
