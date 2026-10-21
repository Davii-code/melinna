import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { NewTaskDialog } from '../../../src/renderer/components/NewTaskDialog';
import type { AgentDefinition, DetectResult } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { agentDef } from '../../support/renderer-fixtures';

const agents: AgentDefinition[] = [agentDef('claude'), agentDef('codex'), agentDef('gemini')];
const detect: Record<string, DetectResult> = {
  claude: { installed: true, searched: 'claude' },
  codex: { installed: true, searched: 'codex' },
  gemini: { installed: false, searched: 'gemini', reason: 'Executável gemini não encontrado.' },
};

function setup(over: { liveCount?: number } = {}) {
  const api = fakeApi();
  const onLaunched = vi.fn();
  const snap = snapshot({ groups: [{ id: 'g1', name: 'Frente', order: 0 }], liveCount: over.liveCount ?? 0 });
  render(
    <ApiContext.Provider value={api}>
      <NewTaskDialog
        snapshot={snap}
        agents={agents}
        detect={detect}
        size={{ cols: 100, rows: 30 }}
        onClose={() => undefined}
        onLaunched={onLaunched}
      />
    </ApiContext.Provider>,
  );
  return { api, onLaunched, user: userEvent.setup() };
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Repositório'), '/repo');
  await user.clear(screen.getByLabelText('Ponto de partida'));
  await user.type(screen.getByLabelText('Ponto de partida'), 'main');
  await user.type(screen.getByLabelText('Enunciado'), 'Faça X');
}

describe('NewTaskDialog', () => {
  it('shows not-found agents with the searched name and does not let them be checked', () => {
    setup();
    const row = screen.getByTestId('agent-gemini');
    expect(within(row).getByText('não encontrado — procurado: gemini')).toBeTruthy();
    expect((within(row).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });

  it('requires a repository and an agent but not a prompt', async () => {
    const { user } = setup();
    expect((screen.getByRole('button', { name: 'Lançar' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    expect((screen.getByRole('button', { name: 'Lançar' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText('Repositório'), '/repo');
    expect((screen.getByRole('button', { name: 'Lançar' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('prevents checking more agents than free slots', async () => {
    const { user } = setup({ liveCount: 11 });
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    expect(
      (within(screen.getByTestId('agent-codex')).getByRole('checkbox') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText('1 vaga(s) livre(s)')).toBeTruthy();
  });

  it('launches with default model and mode per pick', async () => {
    const { user, api, onLaunched } = setup();
    api.tasks.createAndLaunch.mockImplementation(() =>
      okR({ taskId: 't9', results: [{ execId: 'e1', agentId: 'claude', ok: true as const }] }),
    );
    await fillBasics(user);
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    await user.click(within(screen.getByTestId('agent-codex')).getByRole('checkbox'));
    await user.selectOptions(screen.getByLabelText('Modelo de codex'), 'opus');
    await user.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
    expect(api.workspace.inspectRepo).toHaveBeenCalledWith('/repo', 'main');
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toEqual({
      groupId: 'g1',
      repoPath: '/repo',
      baseRef: 'main',
      prompt: 'Faça X',
      picks: [
        { agentId: 'claude', model: 'sonnet', permission: 'manual' },
        { agentId: 'codex', model: 'opus', permission: 'manual' },
      ],
      size: { cols: 100, rows: 30 },
    });
    expect(onLaunched).toHaveBeenCalledWith('t9', [{ execId: 'e1', agentId: 'claude', ok: true }]);
  });

  it('requires "Lançar mesmo assim" when the repo has uncommitted changes', async () => {
    const { user, api } = setup();
    api.workspace.inspectRepo.mockImplementation(() =>
      okR({ root: '/repo', baseCommit: 'a'.repeat(40), uncommittedCount: 3 }),
    );
    await fillBasics(user);
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Lançar' }));
    expect(await screen.findByText(/O repositório tem 3 alterações não commitadas/)).toBeTruthy();
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Lançar mesmo assim' }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
  });

  it('shows the error message from the main process', async () => {
    const { user, api } = setup();
    api.workspace.inspectRepo.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'REPO_INVALID' as const, message: '/repo não é um repositório git.' },
      }),
    );
    await fillBasics(user);
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Lançar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('/repo não é um repositório git.');
  });

  it('creates a new group when chosen', async () => {
    const { user, api } = setup();
    await user.selectOptions(screen.getByLabelText('Grupo'), '__new__');
    await user.type(screen.getByLabelText('Nome do novo grupo'), 'Outro');
    await fillBasics(user);
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.workspace.createGroup).toHaveBeenCalledWith('Outro');
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0].groupId).toBe('g-new');
  });

  it('fills the repository from the native picker', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Escolher…' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Repositório') as HTMLInputElement).value).toBe('/escolhido'),
    );
  });
  it('prefills the folder of the chosen workspace and launches without a prompt', async () => {
    const api = fakeApi();
    const snap = snapshot({
      groups: [
        { id: 'g1', name: 'Frente', order: 0 },
        { id: 'w1', name: 'site', order: 1, repoPath: '/repos/site', lastOpenedAt: '2026-10-21T08:00:00.000Z' },
        { id: 'w2', name: 'api', order: 2, repoPath: '/repos/api', lastOpenedAt: '2026-10-20T08:00:00.000Z' },
      ],
    });
    render(
      <ApiContext.Provider value={api}>
        <NewTaskDialog snapshot={snap} agents={agents} detect={detect} size={{ cols: 100, rows: 30 }} onClose={() => undefined} onLaunched={() => undefined} />
      </ApiContext.Provider>,
    );
    const user = userEvent.setup();
    expect((screen.getByLabelText('Grupo') as HTMLSelectElement).value).toBe('w1');
    expect((screen.getByLabelText('Repositório') as HTMLInputElement).value).toBe('/repos/site');
    await user.selectOptions(screen.getByLabelText('Grupo'), 'w2');
    expect((screen.getByLabelText('Repositório') as HTMLInputElement).value).toBe('/repos/api');
    await user.click(within(screen.getByTestId('agent-claude')).getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toMatchObject({ groupId: 'w2', repoPath: '/repos/api', prompt: '' });
  });
});
