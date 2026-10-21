import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { RemoveExecutionDialog } from '../../../src/renderer/components/RemoveExecutionDialog';
import { fakeApi, okR } from '../../support/fake-api';
import { execution } from '../../support/renderer-fixtures';

function setup(check = { uncommittedFiles: 0, unmergedCommits: 0, branch: 'melinna/t/claude' }) {
  const api = fakeApi();
  api.executions.removalCheck.mockImplementation(() => okR(check));
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <RemoveExecutionDialog
        execution={execution('e1', { status: 'exited', branch: check.branch })}
        agentName="Claude Code"
        onDone={onDone}
        onCancel={onCancel}
      />
    </ApiContext.Provider>,
  );
  return { api, onDone, onCancel };
}

describe('RemoveExecutionDialog', () => {
  it('removes without loss keeping the branch by default', async () => {
    const { api, onDone } = setup();
    await screen.findByText(/nenhum trabalho será perdido/i);
    expect((screen.getByRole('checkbox', { name: /apagar a branch/i }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /^remover$/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.executions.remove).toHaveBeenCalledWith('e1', { deleteBranch: false, force: false });
  });

  it('deletes the branch when chosen', async () => {
    const { api } = setup();
    await screen.findByText(/nenhum trabalho será perdido/i);
    fireEvent.click(screen.getByRole('checkbox', { name: /apagar a branch/i }));
    fireEvent.click(screen.getByRole('button', { name: /^remover$/i }));
    await waitFor(() =>
      expect(api.executions.remove).toHaveBeenCalledWith('e1', { deleteBranch: true, force: false }),
    );
  });

  it('shows the loss counts and requires explicit confirmation to force', async () => {
    const { api, onDone } = setup({ uncommittedFiles: 3, unmergedCommits: 2, branch: 'melinna/t/claude' });
    await screen.findByText(/3 arquivos não commitados/i);
    expect(screen.queryByText(/2 commits/i)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /apagar a branch/i }));
    expect(screen.getByText(/2 commits fora da base/i)).toBeTruthy();
    const removeBtn = screen.getByRole('button', { name: /remover e descartar/i }) as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /entendo que esse trabalho será perdido/i }));
    expect(removeBtn.disabled).toBe(false);
    fireEvent.click(removeBtn);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.executions.remove).toHaveBeenCalledWith('e1', { deleteBranch: true, force: true });
  });

  it('keeping the branch avoids losing unmerged commits', async () => {
    setup({ uncommittedFiles: 0, unmergedCommits: 4, branch: 'melinna/t/claude' });
    await screen.findByText(/nenhum trabalho será perdido/i);
    expect(screen.getByText(/4 commits ficam na branch/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^remover$/i })).toBeTruthy();
  });

  it('shows the error and stays open when removal fails', async () => {
    const { api, onDone } = setup();
    api.executions.remove.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'GIT_FAILED', message: 'O comando git worktree falhou' } }),
    );
    await screen.findByText(/nenhum trabalho será perdido/i);
    fireEvent.click(screen.getByRole('button', { name: /^remover$/i }));
    await screen.findByText('O comando git worktree falhou');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('cancels', async () => {
    const { onCancel, api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(api.executions.remove).not.toHaveBeenCalled();
  });

  it('in a direct run, says the folder is kept and offers no branch option', async () => {
    const api = fakeApi();
    api.executions.removalCheck.mockImplementation(() => okR({ uncommittedFiles: 0, unmergedCommits: 0, branch: '' }));
    const onDone = vi.fn();
    render(
      <ApiContext.Provider value={api}>
        <RemoveExecutionDialog
          execution={execution('e1', { status: 'exited', branch: '', worktreePath: '/minha/pasta' })}
          agentName="Claude Code"
          direct
          onDone={onDone}
          onCancel={vi.fn()}
        />
      </ApiContext.Provider>,
    );
    expect(screen.getByText(/a pasta/i).textContent).toMatch(/A pasta /minha/pasta não é apagada/);
    expect(screen.queryByRole('checkbox', { name: /apagar a branch/i })).toBeNull();
    const remove = screen.getByRole('button', { name: /^remover$/i }) as HTMLButtonElement;
    await waitFor(() => expect(remove.disabled).toBe(false));
    fireEvent.click(remove);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.executions.remove).toHaveBeenCalledWith('e1', { deleteBranch: false, force: false });
  });
});
