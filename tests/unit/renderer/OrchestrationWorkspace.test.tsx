import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrchestrationWorkspace } from '../../../src/renderer/components/Orchestration/OrchestrationWorkspace';
import {
  DEFAULT_TEAM,
  type OrchestrationApi,
  type OrchestrationRun,
  type OrchestrationSnapshot,
} from '../../../src/shared/orchestration-api';
import { okR } from '../../support/fake-api';
import { agentDef } from '../../support/renderer-fixtures';

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
function completedRun(): OrchestrationRun {
  return {
    id: 'run',
    team: { ...structuredClone(DEFAULT_TEAM), id: 'team' },
    groupId: 'workspace',
    cwd: '/repo',
    objective: 'Fixture objective',
    status: 'succeeded',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    coordinatorTurn: 2,
    coordinatorEvents: [],
    messages: [{ role: 'assistant', text: 'Final answer', at: new Date().toISOString() }],
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    jobs: [
      {
        id: 'job',
        roleId: 'developer',
        requestKey: 'one',
        prompt: 'Implement a fixture',
        status: 'succeeded',
        cwd: '/isolated/job',
        baseCommit: 'a'.repeat(40),
        createdAt: new Date().toISOString(),
        events: [{ seq: 1, at: new Date().toISOString(), type: 'text', text: 'worker activity' }],
        result: 'worker result',
      },
    ],
  };
}
function setup(runs: OrchestrationRun[] = []) {
  const state: OrchestrationSnapshot = { schemaVersion: 1, templates: [], runs };
  const api = {
    snapshot: vi.fn(() => okR(structuredClone(state))),
    saveTeam: vi.fn(async (team) => {
      const saved = { ...team, id: team.id || 'team' };
      state.templates = [saved];
      return { ok: true as const, value: saved };
    }),
    removeTeam: vi.fn(() => okR(undefined)),
    preflight: vi.fn(() => okR([{ provider: 'claude' as const, available: true, version: 'fake-1' }])),
    start: vi.fn(() => okR('run')),
    message: vi.fn(() => okR(undefined)),
    control: vi.fn(() => okR(undefined)),
    cancelJob: vi.fn(() => okR(undefined)),
    retryJob: vi.fn(() => okR(undefined)),
    patch: vi.fn(() => okR('diff --git a/file b/file\n+new content')),
    applyPatch: vi.fn(() => okR(undefined)),
    onChange: vi.fn(() => () => undefined),
  } satisfies OrchestrationApi;
  const onClose = vi.fn();
  const view = render(
    <OrchestrationWorkspace
      api={api}
      open
      onClose={onClose}
      groups={[{ id: 'workspace', name: 'Fixture', order: 0, repoPath: '/repo' }]}
      activeGroupId="workspace"
      agents={[agentDef('claude'), agentDef('codex')]}
    />,
  );
  return { api, onClose, view };
}
describe('visual orchestration workspace', () => {
  it('renders the coordinator and workers and keeps coordinator permissions read-only', async () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Um objetivo. Uma equipe.' })).toBeTruthy();
    expect(screen.getByLabelText('Permissão').getAttribute('disabled')).not.toBeNull();
    expect(screen.getByLabelText('Provedor')).toHaveProperty('value', 'claude');
    fireEvent.change(screen.getByLabelText('Provedor'), { target: { value: 'codex' } });
    expect(screen.getByLabelText('Modelo')).toHaveProperty('value', '');
  });
  it('saves the edited team and sends the objective to the selected workspace', async () => {
    const { api } = setup();
    fireEvent.change(screen.getByLabelText('Nome da equipe'), { target: { value: 'Visual fixture' } });
    fireEvent.change(screen.getByLabelText('O que a equipe deve fazer?'), {
      target: { value: 'Analyze fixture' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar orquestração' }));
    await waitFor(() =>
      expect(api.start).toHaveBeenCalledWith({
        teamId: 'team',
        groupId: 'workspace',
        prompt: 'Analyze fixture',
      }),
    );
    expect(api.saveTeam.mock.calls[0]?.[0].name).toBe('Visual fixture');
  });
  it('adds and removes a worker through the same editable hierarchy', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar trabalhador' }));
    expect(screen.getByLabelText('Nome do papel')).toHaveProperty('value', 'Novo trabalhador');
    fireEvent.click(screen.getByRole('button', { name: 'Remover papel' }));
    expect(screen.getByLabelText('Nome do papel')).toHaveProperty('value', 'Coordenador');
  });
  it('shows a real worker transcript without presenting it as an interactive terminal', async () => {
    setup([completedRun()]);
    fireEvent.click(await screen.findByRole('button', { name: /Fixture objective/ }));
    fireEvent.click(screen.getByRole('button', { name: /Implement a fixture/ }));
    expect(screen.getByRole('log').textContent).toContain('worker activity');
    expect(screen.getByText('worker result')).toBeTruthy();
    expect(screen.getByText(/não é uma segunda CLI/)).toBeTruthy();
  });
  it('requires explicit confirmation before applying a reviewed patch', async () => {
    const { api } = setup([completedRun()]);
    fireEvent.click(await screen.findByRole('button', { name: /Fixture objective/ }));
    fireEvent.click(screen.getByRole('button', { name: /Implement a fixture/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Revisar alterações' }));
    await screen.findByText(/new content/);
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar ao workspace' }));
    expect(api.applyPatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar patch' }));
    await waitFor(() => expect(api.applyPatch).toHaveBeenCalledWith('run', 'job'));
  });
  it('closes with Escape and can inspect availability without starting an agent', async () => {
    const { api, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Verificar CLIs' }));
    await screen.findByText('claude: fake-1');
    expect(api.start).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
