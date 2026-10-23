import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import {
  RemoveFromListDialog,
  type RemoveTarget,
} from '../../../src/renderer/components/RemoveFromListDialog';
import type { Group, Task } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { execution } from '../../support/renderer-fixtures';

const group: Group = { id: 'w1', name: 'site', order: 0, repoPath: '/repos/site' };

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    groupId: 'w1',
    title: `Sessão ${id}`,
    prompt: '',
    repoPath: '/repos/site',
    repoId: 'r',
    baseRef: 'HEAD',
    baseCommit: '',
    slug: 's',
    createdAt: '2026-10-21T09:00:00.000Z',
    isolation: 'direct',
    ...over,
  };
}

/** Sessão gravada antes da execução direta: sem `isolation`, rodava em worktree. */
const { isolation: _isolation, ...legacy } = task('t2', { baseCommit: 'a'.repeat(40) });
const tasks: Task[] = [task('t1'), legacy];
const executions = [
  execution('e1', { taskId: 't1', status: 'exited', branch: '', worktreePath: '/repos/site' }),
  execution('e2', { taskId: 't2', status: 'exited', branch: 'melinna/s/claude' }),
];

function setup(target: RemoveTarget) {
  const api = fakeApi();
  const onDone = vi.fn();
  const onCancel = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <RemoveFromListDialog
        target={target}
        tasks={tasks}
        executions={executions}
        onDone={onDone}
        onCancel={onCancel}
      />
    </ApiContext.Provider>,
  );
  return { api, onDone, onCancel };
}

describe('RemoveFromListDialog', () => {
  it('removes a direct session, saying the folder is kept', async () => {
    const { api, onDone } = setup({ kind: 'task', task: tasks[0]! });
    const dialog = screen.getByRole('alertdialog', { name: 'Remover sessão Sessão t1' });
    expect(dialog.textContent).toMatch(/histórico de 1 terminal/);
    expect(dialog.textContent).toMatch(/A pasta \/repos\/site não é apagada/);
    expect(dialog.textContent).not.toMatch(/worktree/);
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.tasks.remove).toHaveBeenCalledWith('t1');
  });

  it('removes a workspace with all its sessions and warns about old worktrees', async () => {
    const { api, onDone } = setup({ kind: 'workspace', group });
    const dialog = screen.getByRole('alertdialog', { name: 'Remover workspace site' });
    expect(dialog.textContent).toMatch(/2 sessões saem junto/);
    expect(dialog.textContent).toMatch(/1 worktree antigo será apagado/);
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.tasks.removeWorkspace).toHaveBeenCalledWith('w1');
  });

  it('shows the error and stays open when removal fails', async () => {
    const { api, onDone } = setup({ kind: 'workspace', group });
    api.tasks.removeWorkspace.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: 'EXECUTION_RUNNING' as const,
          message: 'Pare as sessões do workspace antes de removê-lo.',
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Pare as sessões do workspace antes de removê-lo.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('cancels', () => {
    const { onCancel, api } = setup({ kind: 'task', task: tasks[0]! });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalled();
    expect(api.tasks.remove).not.toHaveBeenCalled();
  });
});

describe('RemoveFromListDialog: prompts do workspace', () => {
  function setupWithPrompts(count: number | 'erro', target: RemoveTarget = { kind: 'workspace', group }) {
    const api = fakeApi();
    api.prompts.countForGroup.mockImplementation(() =>
      count === 'erro'
        ? Promise.resolve({ ok: false as const, error: { code: 'INTERNAL' as const, message: 'falhou' } })
        : okR(count),
    );
    render(
      <ApiContext.Provider value={api}>
        <RemoveFromListDialog
          target={target}
          tasks={tasks}
          executions={executions}
          onDone={vi.fn()}
          onCancel={vi.fn()}
        />
      </ApiContext.Provider>,
    );
    return api;
  }

  it('says how many prompts of the workspace will be removed with it', async () => {
    const api = setupWithPrompts(2);
    expect(await screen.findByText('2 prompts deste workspace serão removidos.')).toBeTruthy();
    expect(api.prompts.countForGroup).toHaveBeenCalledWith('w1');
  });

  it('uses the singular for one prompt', async () => {
    setupWithPrompts(1);
    expect(await screen.findByText('1 prompt deste workspace será removido.')).toBeTruthy();
  });

  it('says nothing when the workspace has no prompts', async () => {
    const api = setupWithPrompts(0);
    await waitFor(() => expect(api.prompts.countForGroup).toHaveBeenCalled());
    expect(screen.getByRole('alertdialog').textContent).not.toMatch(/prompt/);
  });

  it('still allows removing when the count cannot be read', async () => {
    const api = setupWithPrompts('erro');
    await waitFor(() => expect(api.prompts.countForGroup).toHaveBeenCalled());
    expect(screen.getByRole('alertdialog').textContent).not.toMatch(/prompts? deste/);
    expect((screen.getByRole('button', { name: 'Remover' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not look at prompts when removing a single session', async () => {
    const api = setupWithPrompts(3, { kind: 'task', task: tasks[0]! });
    await Promise.resolve();
    expect(api.prompts.countForGroup).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog').textContent).not.toMatch(/prompt/);
  });
});
