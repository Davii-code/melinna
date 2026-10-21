import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ResidueDialog } from '../../../src/renderer/components/ResidueDialog';
import { fakeApi } from '../../support/fake-api';

const PATH = '/data/worktrees/r/e9';

function setup() {
  const api = fakeApi();
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <ResidueDialog residuePath={PATH} message="Há um resíduo de worktree." onDone={onDone} onCancel={onCancel} />
    </ApiContext.Provider>,
  );
  return { api, onDone, onCancel };
}

describe('ResidueDialog', () => {
  it('shows the path and cleans after confirmation', async () => {
    const { api, onDone } = setup();
    expect(screen.getByText(PATH)).toBeTruthy();
    expect(screen.getByText('Há um resíduo de worktree.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /limpar resíduo/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.workspace.cleanResidue).toHaveBeenCalledWith(PATH);
  });

  it('shows the error when cleaning fails', async () => {
    const { api, onDone } = setup();
    api.workspace.cleanResidue.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'WORKTREE_IN_USE', message: 'Worktree em uso pela execução x.' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: /limpar resíduo/i }));
    await screen.findByText('Worktree em uso pela execução x.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('cancels without cleaning', () => {
    const { api, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalled();
    expect(api.workspace.cleanResidue).not.toHaveBeenCalled();
  });
});
