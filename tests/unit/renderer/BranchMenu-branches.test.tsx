import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BranchMenu } from '../../../src/renderer/components/Git/BranchMenu';
import { BRANCH_RULE } from '../../../src/renderer/components/Git/git-ui';
import type { Branch, RepoStatus } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { renderWithGit } from '../../support/git-render';

const BRANCHES: Branch[] = [
  { name: 'main', kind: 'local', current: true, upstream: 'origin/main' },
  { name: 'feature/login', kind: 'local', current: false },
  { name: 'origin/so-no-remoto', kind: 'remote', current: false },
];

function setup(
  statuses: Record<string, Partial<RepoStatus>> = { '/repo': {} },
  roots = Object.keys(statuses),
) {
  const api = fakeApi();
  api.git.branches.mockImplementation(() => okR(BRANCHES));
  const onConflicts = vi.fn();
  const view = renderWithGit(<BranchMenu onConflicts={onConflicts} />, { api, roots, statuses });
  return { ...view, onConflicts };
}

const trigger = () => screen.findByRole('button', { name: /^Branch / });
async function open() {
  fireEvent.click(await trigger());
  return screen.getByRole('menu');
}

describe('BranchMenu button', () => {
  it('shows the branch of the main repo with ahead and behind', async () => {
    setup({ '/repo': { branch: 'feature/x', ahead: 2, behind: 3 } });
    const button = await trigger();
    expect(button.getAttribute('aria-label')).toBe('Branch feature/x');
    expect(within(button).getByText('↑2')).toBeTruthy();
    expect(within(button).getByText('↓3')).toBeTruthy();
  });

  it('hides ahead and behind without an upstream', async () => {
    setup({ '/repo': { upstream: null, ahead: null, behind: null } });
    const button = await trigger();
    expect(within(button).queryByText(/↑/)).toBeNull();
    expect(within(button).queryByText(/↓/)).toBeNull();
  });

  it('says the HEAD is detached', async () => {
    setup({
      '/repo': {
        branch: null,
        state: 'detached',
        head: 'abcdef1234567890',
        upstream: null,
        ahead: null,
        behind: null,
      },
    });
    expect((await trigger()).getAttribute('aria-label')).toBe('Branch HEAD solto em abcdef1');
  });

  it('shows +N when there are other repos', async () => {
    setup({ '/a': { branch: 'main' }, '/b': { branch: 'dev' }, '/c': {} });
    const button = await trigger();
    expect(button.getAttribute('aria-label')).toBe('Branch main');
    expect(within(button).getByText('+2')).toBeTruthy();
  });

  it('is disabled with "Sem git" when no folder is a repository', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() =>
      Promise.resolve({ ok: false as const, error: { code: 'REPO_INVALID' as const, message: 'não é git' } }),
    );
    renderWithGit(<BranchMenu onConflicts={vi.fn()} />, { api, roots: ['/x'] });
    const button = (await screen.findByRole('button', { name: 'Sem git' })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('abbreviates a long name and keeps the whole name in the tooltip', async () => {
    const long = 'feature/uma-branch-com-um-nome-realmente-muito-longo-mesmo';
    setup({ '/repo': { branch: long } });
    const button = await trigger();
    expect(button.getAttribute('title')).toContain(long);
    expect(button.textContent).not.toContain(long);
    expect(button.textContent).toContain('…');
  });
});

describe('BranchMenu per repo', () => {
  it('lists each repo with branch and ahead/behind', async () => {
    setup({
      '/a': { branch: 'main', ahead: 1, behind: 0 },
      '/b': { branch: 'dev', upstream: null, ahead: null, behind: null },
    });
    const menu = await open();
    const a = within(menu).getByRole('group', { name: 'a' });
    expect(a.textContent).toContain('main');
    expect(a.textContent).toContain('↑1');
    expect(within(menu).getByRole('group', { name: 'b' }).textContent).toContain('dev');
  });

  it('lists local and remote branches with the current one marked', async () => {
    setup();
    await open();
    expect(await screen.findByRole('menuitem', { name: 'Trocar para feature/login' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Trocar para origin/so-no-remoto' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Trocar para main' })).toBeNull();
    expect(screen.getByTestId('branch-main').textContent).toMatch(/atual/);
  });

  it('switches branch', async () => {
    const { api } = setup();
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Trocar para feature/login' }));
    await waitFor(() => expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'feature/login'));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('confirms switching with pending changes', async () => {
    const { api } = setup();
    api.git.checkout.mockImplementationOnce(() =>
      okR<never>({
        needsConfirm: 'checkout-dirty',
        details: { files: [{ path: 'src/a.ts' }], branch: 'feature/login' },
      } as never),
    );
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Trocar para feature/login' }));
    expect(await screen.findByTestId('git-confirm-files')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar' }));
    await waitFor(() => expect(api.git.checkout).toHaveBeenCalledTimes(2));
    expect(api.git.checkout).toHaveBeenLastCalledWith('/repo', 'feature/login', ['checkout-dirty']);
  });

  it('merges into the current branch, confirming when dirty', async () => {
    const { api } = setup();
    api.git.merge.mockImplementationOnce(() =>
      okR<never>({ needsConfirm: 'merge-dirty', details: {} } as never),
    );
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mesclar feature/login na atual' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(api.git.merge).toHaveBeenCalledTimes(2));
    expect(api.git.merge).toHaveBeenLastCalledWith('/repo', 'feature/login', ['merge-dirty']);
  });

  it('reports merge conflicts to open the Commit panel', async () => {
    const { api, onConflicts } = setup();
    api.git.merge.mockImplementationOnce(() => okR({ conflicts: ['a.ts'] }));
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mesclar feature/login na atual' }));
    await waitFor(() => expect(onConflicts).toHaveBeenCalledWith('/repo'));
  });

  it('creates a branch, checking the name rule first', async () => {
    const { api } = setup();
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Nova branch…' }));
    const input = screen.getByLabelText('Nome da nova branch');
    fireEvent.change(input, { target: { value: 'nome inválido~' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
    expect((await screen.findByRole('alert')).textContent).toBe(BRANCH_RULE);
    expect(api.git.createBranch).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'feature/nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
    await waitFor(() => expect(api.git.createBranch).toHaveBeenCalledWith('/repo', 'feature/nova'));
  });

  it('shows the error of git when creating fails', async () => {
    const { api } = setup();
    api.git.createBranch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'GIT_FAILED' as const, message: 'A branch já existe.' },
      }),
    );
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Nova branch…' }));
    fireEvent.change(screen.getByLabelText('Nome da nova branch'), { target: { value: 'main2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
    expect((await screen.findByRole('alert')).textContent).toBe('A branch já existe.');
  });

  it('disables switching, merging and pull during a rebase, with the instruction', async () => {
    setup({ '/repo': { state: 'rebasing' } });
    await open();
    const swap = await screen.findByRole('menuitem', { name: 'Trocar para feature/login' });
    expect((swap as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('menuitem', { name: 'Mesclar feature/login na atual' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByRole('menuitem', { name: 'Pull' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Rebase em andamento.*conclua fora do app/)).toBeTruthy();
  });

  it('says a cherry-pick is in progress', async () => {
    setup({ '/repo': { state: 'cherry-picking' } });
    await open();
    expect(await screen.findByText(/Cherry-pick em andamento.*conclua fora do app/)).toBeTruthy();
  });

  it('opens the history of the repo', async () => {
    const { api } = setup();
    await open();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Histórico' }));
    expect(await screen.findByRole('dialog', { name: /Histórico/ })).toBeTruthy();
    expect(api.git.log).toHaveBeenCalledWith('/repo', 0);
  });
});
