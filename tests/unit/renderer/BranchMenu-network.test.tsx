import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BranchMenu } from '../../../src/renderer/components/Git/BranchMenu';
import type { NeedsConfirm, RepoStatus } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { renderWithGit } from '../../support/git-render';

function setup(statuses: Record<string, Partial<RepoStatus>> = { '/repo': {} }) {
  const api = fakeApi();
  api.git.fetch.mockImplementation((repo: string) => okR({ opId: `op-${repo}` }));
  api.git.pull.mockImplementation((repo: string) => okR<never>({ opId: `op-${repo}` } as never));
  api.git.push.mockImplementation((repo: string) => okR<never>({ opId: `op-${repo}` } as never));
  const onConflicts = vi.fn();
  const view = renderWithGit(<BranchMenu onConflicts={onConflicts} />, {
    api,
    roots: Object.keys(statuses),
    statuses,
  });
  return { ...view, onConflicts };
}

const need = (n: NeedsConfirm['needsConfirm'], details: NeedsConfirm['details'] = {}): never =>
  ({ needsConfirm: n, details }) as never;

async function item(name: string) {
  if (!screen.queryByRole('menu')) fireEvent.click(await screen.findByRole('button', { name: /^Branch / }));
  const found = await within(screen.getByRole('menu')).findByRole('menuitem', { name });
  fireEvent.click(found);
}

describe('BranchMenu network actions', () => {
  it('shows progress and Cancelar in the top bar while fetching', async () => {
    const { api } = setup();
    await item('Fetch');
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalledWith('/repo'));
    await screen.findByText(/Fetch: Iniciando/);
    act(() => api.emitGitProgress({ opId: 'op-/repo', phase: 'Recebendo objetos', percent: 30 }));
    expect(screen.getByText(/Fetch: Recebendo objetos/)).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.git.cancel).toHaveBeenCalledWith('op-/repo');
    act(() => api.emitGitProgress({ opId: 'op-/repo', phase: 'fim', done: true }));
    await waitFor(() => expect(screen.queryByText(/Fetch:/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  });

  it('asks merge-dirty before pulling and repeats with the confirmation', async () => {
    const { api } = setup();
    api.git.pull.mockImplementationOnce(() => okR(need('merge-dirty')));
    await item('Pull');
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(api.git.pull).toHaveBeenCalledTimes(2));
    expect(api.git.pull).toHaveBeenLastCalledWith('/repo', ['merge-dirty']);
  });

  it('asks set-upstream and then push-main, accumulating the confirmations', async () => {
    const { api } = setup();
    api.git.push.mockImplementationOnce(() =>
      okR(need('set-upstream', { branch: 'nova', remote: 'origin' })),
    );
    api.git.push.mockImplementationOnce(() => okR(need('push-main', { branch: 'main' })));
    await item('Push…');
    fireEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.git.push).toHaveBeenCalledTimes(3));
    expect(api.git.push).toHaveBeenLastCalledWith('/repo', ['set-upstream', 'push-main']);
  });

  it('refusing a confirmation does not push', async () => {
    const { api } = setup();
    api.git.push.mockImplementationOnce(() => okR(need('push-main', { branch: 'main' })));
    await item('Push…');
    await screen.findByRole('button', { name: 'Enviar' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull());
    expect(api.git.push).toHaveBeenCalledTimes(1);
  });

  it('shows the authentication error with its guidance', async () => {
    const { api } = setup();
    api.git.push.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: 'GIT_AUTH' as const,
          message: 'Falha de autenticação. Entre com o gerenciador de credenciais do git.',
        },
      }),
    );
    await item('Push…');
    expect((await screen.findByRole('alert')).textContent).toMatch(/gerenciador de credenciais/);
  });

  it('shows the error of an operation that ended badly', async () => {
    const { api } = setup();
    await item('Fetch');
    await screen.findByText(/Fetch: Iniciando/);
    act(() =>
      api.emitGitProgress({
        opId: 'op-/repo',
        phase: 'fim',
        done: true,
        error: { code: 'GIT_AUTH', message: 'Sem acesso ao remoto.' } as never,
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sem acesso ao remoto/);
  });

  it('opens the conflicts when a pull ends with them', async () => {
    const { api, onConflicts } = setup();
    await item('Pull');
    await screen.findByText(/Pull: Iniciando/);
    act(() =>
      api.emitGitProgress({ opId: 'op-/repo', phase: 'fim', done: true, result: { conflicts: ['a.ts'] } }),
    );
    await waitFor(() => expect(onConflicts).toHaveBeenCalledWith('/repo'));
  });

  it('has Fetch todos and Pull todos only with several repos', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /^Branch / }));
    expect(screen.queryByRole('menuitem', { name: 'Fetch todos' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Pull todos' })).toBeNull();
  });

  it('fetches all repos one at a time and reports each result', async () => {
    const { api } = setup({ '/a': {}, '/b': {} });
    await item('Fetch todos');
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalledTimes(1));
    expect(api.git.fetch).toHaveBeenLastCalledWith('/a');
    await screen.findByText(/Fetch: Iniciando/);
    expect(api.git.fetch).toHaveBeenCalledTimes(1);
    act(() => api.emitGitProgress({ opId: 'op-/a', phase: 'fim', done: true }));
    await waitFor(() => expect(api.git.fetch).toHaveBeenCalledTimes(2));
    expect(api.git.fetch).toHaveBeenLastCalledWith('/b');
    await screen.findByText(/Fetch: Iniciando/);
    act(() =>
      api.emitGitProgress({
        opId: 'op-/b',
        phase: 'fim',
        done: true,
        error: { code: 'GIT_AUTH', message: 'sem acesso' } as never,
      }),
    );
    expect(await screen.findByText(/a: concluído/)).toBeTruthy();
    expect(screen.getByText(/b: falhou: sem acesso/)).toBeTruthy();
  });

  it('pulls all repos in sequence', async () => {
    const { api } = setup({ '/a': {}, '/b': {} });
    await item('Pull todos');
    await waitFor(() => expect(api.git.pull).toHaveBeenCalledTimes(1));
    act(() => api.emitGitProgress({ opId: 'op-/a', phase: 'fim', done: true }));
    await waitFor(() => expect(api.git.pull).toHaveBeenCalledTimes(2));
    act(() => api.emitGitProgress({ opId: 'op-/b', phase: 'fim', done: true }));
    expect(await screen.findByText(/b: concluído/)).toBeTruthy();
  });

  it('disables network actions without a remote', async () => {
    setup({ '/repo': { hasRemote: false } });
    fireEvent.click(await screen.findByRole('button', { name: /^Branch / }));
    const fetchItem = (await screen.findByRole('menuitem', { name: 'Fetch' })) as HTMLButtonElement;
    expect(fetchItem.disabled).toBe(true);
    expect(fetchItem.title).toMatch(/sem remoto/i);
  });
});
