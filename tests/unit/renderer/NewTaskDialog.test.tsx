import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { NewTaskDialog } from '../../../src/renderer/components/NewTaskDialog';
import type { AgentDefinition, DetectResult, Group } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { agentDef } from '../../support/renderer-fixtures';

const agents: AgentDefinition[] = [agentDef('claude'), agentDef('codex'), agentDef('gemini')];
const detect: Record<string, DetectResult> = {
  claude: { installed: true, searched: 'claude' },
  codex: { installed: true, searched: 'codex' },
  gemini: { installed: false, searched: 'gemini', reason: 'Executável gemini não encontrado.' },
};

function setup(over: { liveCount?: number; groups?: Group[] } = {}) {
  const api = fakeApi();
  const onLaunched = vi.fn();
  const snap = snapshot({
    groups: over.groups ?? [{ id: 'g1', name: 'Frente', order: 0 }],
    liveCount: over.liveCount ?? 0,
  });
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

const launchButton = () => screen.getByRole('button', { name: 'Lançar' }) as HTMLButtonElement;

describe('NewTaskDialog', () => {
  it('shows only folder, prompt and agent up front, with the rest under "Avançado"', () => {
    setup();
    expect(screen.getByLabelText('Pasta')).toBeTruthy();
    expect(screen.getByLabelText('Enunciado')).toBeTruthy();
    const agent = screen.getByLabelText('Agente') as HTMLSelectElement;
    expect(Array.from(agent.options).map((o) => o.value)).toEqual(['claude', 'codex']);
    expect(screen.queryByLabelText('Grupo')).toBeNull();
    expect(screen.queryByLabelText('Ponto de partida')).toBeNull();
    const advanced = screen.getByText('Avançado').closest('details') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    expect(advanced.contains(screen.getByLabelText('Modelo'))).toBe(true);
    expect(advanced.contains(screen.getByLabelText('Modo de permissão'))).toBe(true);
    expect(advanced.contains(screen.getByLabelText('Título (opcional)'))).toBe(true);
  });

  it('requires a folder but not a prompt', async () => {
    const { user } = setup();
    expect(launchButton().disabled).toBe(true);
    await user.type(screen.getByLabelText('Pasta'), '/qualquer');
    expect(launchButton().disabled).toBe(false);
  });

  it('blocks launching when there is no free slot', async () => {
    const { user } = setup({ liveCount: 12 });
    await user.type(screen.getByLabelText('Pasta'), '/qualquer');
    expect(launchButton().disabled).toBe(true);
    expect(screen.getByText(/não há vagas livres/i)).toBeTruthy();
  });

  it('opens the folder as a workspace and launches one agent there with its defaults', async () => {
    const { user, api, onLaunched } = setup();
    api.tasks.createAndLaunch.mockImplementation(() =>
      okR({ taskId: 't9', results: [{ execId: 'e1', agentId: 'claude', ok: true as const }] }),
    );
    await user.type(screen.getByLabelText('Pasta'), '/minha/pasta');
    await user.type(screen.getByLabelText('Enunciado'), 'Faça X');
    await user.click(launchButton());
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
    expect(api.workspace.openWorkspace).toHaveBeenCalledWith('/minha/pasta');
    expect(api.workspace.inspectRepo).not.toHaveBeenCalled();
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toEqual({
      groupId: 'ws-new',
      repoPath: '/minha/pasta',
      baseRef: 'HEAD',
      prompt: 'Faça X',
      picks: [{ agentId: 'claude', model: 'sonnet', permission: 'manual' }],
      size: { cols: 100, rows: 30 },
    });
    expect(onLaunched).toHaveBeenCalledWith('t9', [{ execId: 'e1', agentId: 'claude', ok: true }]);
  });

  it('shows the error message from the main process', async () => {
    const { user, api } = setup();
    api.workspace.openWorkspace.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'A pasta /sumiu não existe.' },
      }),
    );
    await user.type(screen.getByLabelText('Pasta'), '/sumiu');
    await user.click(launchButton());
    expect((await screen.findByRole('alert')).textContent).toBe('A pasta /sumiu não existe.');
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
  });

  it('prefills the most recent workspace folder and opens the picker there', async () => {
    const { api } = setup({
      groups: [
        {
          id: 'w1',
          name: 'site',
          order: 0,
          repoPath: '/repos/site',
          lastOpenedAt: '2026-10-21T08:00:00.000Z',
        },
        { id: 'w2', name: 'api', order: 1, repoPath: '/repos/api', lastOpenedAt: '2026-10-20T08:00:00.000Z' },
      ],
    });
    expect((screen.getByLabelText('Pasta') as HTMLInputElement).value).toBe('/repos/site');
    fireEvent.click(screen.getByRole('button', { name: 'Escolher…' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Pasta') as HTMLInputElement).value).toBe('/escolhido'),
    );
    expect(api.workspace.pickRepository).toHaveBeenCalledWith('/repos/site');
  });
});
