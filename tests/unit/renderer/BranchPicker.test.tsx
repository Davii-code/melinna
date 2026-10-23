import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { BranchPicker } from '../../../src/renderer/components/Git/BranchPicker';
import type { Branch } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const BRANCHES: Branch[] = [
  { name: 'main', kind: 'local', current: true, upstream: 'origin/main' },
  { name: 'feature/login', kind: 'local', current: false },
  { name: 'origin/main', kind: 'remote', current: false },
  { name: 'origin/so-no-remoto', kind: 'remote', current: false },
];

function setup() {
  const api = fakeApi();
  api.git.branches.mockImplementation(() => okR(BRANCHES));
  const onClose = vi.fn();
  const onConflicts = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <BranchPicker repo="/repo" onClose={onClose} onConflicts={onConflicts} />
    </ApiContext.Provider>,
  );
  return { api, onClose, onConflicts };
}

async function ready() {
  await screen.findByRole('button', { name: 'Trocar para feature/login' });
}

describe('BranchPicker', () => {
  it('lists local and remote branches and marks the current one', async () => {
    setup();
    await ready();
    const current = screen.getByTestId('branch-main');
    expect(current.textContent).toMatch(/atual/);
    expect(screen.getByRole('button', { name: 'Trocar para origin/so-no-remoto' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Trocar para main' })).toBeNull();
    expect(screen.getByText('Locais')).toBeTruthy();
    expect(screen.getByText('Remotas')).toBeTruthy();
  });

  it('switches to a branch and closes', async () => {
    const { api, onClose } = setup();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar para feature/login' }));
    await waitFor(() => expect(api.git.checkout).toHaveBeenCalledWith('/repo', 'feature/login'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('asks for confirmation listing the pending files before switching', async () => {
    const { api, onClose } = setup();
    api.git.checkout.mockImplementationOnce(() =>
      okR({
        needsConfirm: 'checkout-dirty' as const,
        details: { files: [{ path: 'src/a.ts' }, { path: 'b.md' }], branch: 'feature/login' },
      }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar para feature/login' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('src/a.ts')).toBeTruthy();
    expect(within(dialog).getByText('b.md')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Trocar' }));
    await waitFor(() => expect(api.git.checkout).toHaveBeenLastCalledWith('/repo', 'feature/login', ['checkout-dirty']));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays on the current branch when the confirmation is cancelled', async () => {
    const { api, onClose } = setup();
    api.git.checkout.mockImplementationOnce(() =>
      okR({ needsConfirm: 'checkout-dirty' as const, details: { files: [{ path: 'a' }], branch: 'feature/login' } }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar para feature/login' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.git.checkout).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the error when git refuses the switch', async () => {
    const { api } = setup();
    api.git.checkout.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'GIT_FAILED' as const, message: 'error: Your local changes would be overwritten by checkout' },
      }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Trocar para feature/login' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/would be overwritten/);
  });

  it('creates a branch with a valid name', async () => {
    const { api, onClose } = setup();
    await ready();
    fireEvent.change(screen.getByLabelText('Nome da nova branch'), { target: { value: 'feature/nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
    await waitFor(() => expect(api.git.createBranch).toHaveBeenCalledWith('/repo', 'feature/nova'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows the naming rule for an invalid name without calling git', async () => {
    const { api } = setup();
    await ready();
    for (const name of ['com espaço', '-x', 'a..b', 'x@{1}', 'fim/', 'a.lock']) {
      fireEvent.change(screen.getByLabelText('Nome da nova branch'), { target: { value: name } });
      fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Nome de branch inválido/);
    }
    expect(api.git.createBranch).not.toHaveBeenCalled();
  });

  it('shows the error returned by git for a name it refuses', async () => {
    const { api } = setup();
    api.git.createBranch.mockImplementationOnce(() =>
      Promise.resolve({ ok: false as const, error: { code: 'INPUT_INVALID' as const, message: 'A branch nova já existe.' } }),
    );
    await ready();
    fireEvent.change(screen.getByLabelText('Nome da nova branch'), { target: { value: 'nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar branch' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/já existe/);
  });

  it('merges a branch into the current one and reports conflicts', async () => {
    const { api, onConflicts, onClose } = setup();
    api.git.merge.mockImplementationOnce(() => okR({ conflicts: ['a.txt'] }));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Mesclar feature/login na atual' }));
    await waitFor(() => expect(api.git.merge).toHaveBeenCalledWith('/repo', 'feature/login'));
    await waitFor(() => expect(onConflicts).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes after a clean merge and confirms a merge over pending changes', async () => {
    const { api, onClose } = setup();
    api.git.merge.mockImplementationOnce(() =>
      okR({ needsConfirm: 'merge-dirty' as const, details: { files: [{ path: 'x.txt' }], branch: 'feature/login' } }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Mesclar feature/login na atual' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('x.txt')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(api.git.merge).toHaveBeenLastCalledWith('/repo', 'feature/login', ['merge-dirty']));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
