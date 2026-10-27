import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { defaultAgent, greeting, Home } from '../../../src/renderer/components/Home/Home';
import type {
  AgentDefinition,
  DetectResult,
  Group,
  WorkspaceSnapshot,
} from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { agentDef, shellDef } from '../../support/renderer-fixtures';

const WS: Group[] = [
  {
    id: 'w1',
    name: 'site',
    order: 0,
    repoPath: '/repos/site',
    colorIndex: 0,
    lastOpenedAt: '2026-10-20T10:00:00.000Z',
  },
  {
    id: 'w2',
    name: 'api',
    order: 1,
    repoPath: '/repos/api',
    colorIndex: 1,
    lastOpenedAt: '2026-10-21T08:00:00.000Z',
  },
  { id: 'g3', name: 'Só grupo', order: 2 },
];

const AGENTS: AgentDefinition[] = [
  agentDef('claude'),
  agentDef('codex', { displayName: 'Codex CLI' }),
  shellDef('bash', 'Git Bash'),
];
const DETECT: Record<string, DetectResult> = {
  claude: { installed: true, searched: 'claude' },
  codex: { installed: false, searched: 'codex' },
  bash: { installed: true, searched: 'bash' },
};

function setup(
  snap: WorkspaceSnapshot = snapshot({ groups: WS }),
  agents: AgentDefinition[] = AGENTS,
  detect: Record<string, DetectResult> = DETECT,
) {
  const api = fakeApi();
  const onLaunched = vi.fn();
  const onRemoveWorkspace = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <Home
        snapshot={snap}
        agents={agents}
        detect={detect}
        size={{ cols: 100, rows: 30 }}
        now={new Date('2026-10-21T09:20:00')}
        onLaunched={onLaunched}
        onRemoveWorkspace={onRemoveWorkspace}
      />
    </ApiContext.Provider>,
  );
  return { api, onLaunched, onRemoveWorkspace };
}

const recentList = () => screen.getByRole('list', { name: /workspaces recentes/i });

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(new Date('2026-01-01T07:00:00'))).toBe('Bom dia');
    expect(greeting(new Date('2026-01-01T13:00:00'))).toBe('Boa tarde');
    expect(greeting(new Date('2026-01-01T20:00:00'))).toBe('Boa noite');
    expect(greeting(new Date('2026-01-01T03:00:00'))).toBe('Boa noite');
  });
});

describe('defaultAgent', () => {
  it('prefers the first installed agent and falls back to a shell', () => {
    expect(defaultAgent(AGENTS, DETECT)?.id).toBe('claude');
    expect(defaultAgent(AGENTS, { ...DETECT, claude: { installed: false, searched: 'claude' } })?.id).toBe(
      'bash',
    );
    expect(defaultAgent(AGENTS, {})).toBeUndefined();
  });
});

describe('Home', () => {
  it('shows the two working actions with the original Melinna brand artwork', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Bom dia, Melinna!' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /novo terminal/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /abrir workspace/i })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByRole('img', { name: 'Melinna' }).getAttribute('src')).toContain('avatar.jpg');
    expect(screen.getByText(/abre claude code na pasta escolhida/i)).toBeTruthy();
  });

  it('"Novo terminal" works with no workspace: asks for a folder and opens the default agent there', async () => {
    const { api, onLaunched } = setup(snapshot());
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.workspace.pickRepository).toHaveBeenCalledWith(undefined);
    expect(api.workspace.openWorkspace).toHaveBeenCalledWith('/escolhido');
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toEqual({
      groupId: 'ws-new',
      repoPath: '/escolhido',
      baseRef: 'HEAD',
      prompt: '',
      picks: [{ agentId: 'claude', model: 'sonnet', permission: 'manual' }],
      size: { cols: 100, rows: 30 },
    });
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
  });

  it('"Novo terminal" starts the folder dialog at the most recent workspace and does nothing when canceled', async () => {
    const { api } = setup();
    api.workspace.pickRepository.mockImplementation(() => okR<string | null>(null));
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    await waitFor(() => expect(api.workspace.pickRepository).toHaveBeenCalledWith('/repos/api'));
    expect(api.workspace.openWorkspace).not.toHaveBeenCalled();
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
  });

  it('"Abrir workspace" only opens the folder as a workspace', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /abrir workspace/i }));
    await waitFor(() => expect(api.workspace.openWorkspace).toHaveBeenCalledWith('/escolhido'));
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
  });

  it('lists recent workspaces and opens a terminal in one with a click', async () => {
    const { api } = setup();
    expect(
      within(recentList())
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('/repos/api'), expect.stringContaining('/repos/site')]);
    fireEvent.click(within(recentList()).getByRole('button', { name: /^site/ }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.workspace.pickRepository).not.toHaveBeenCalled();
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toMatchObject({
      groupId: 'w1',
      repoPath: '/repos/site',
    });
  });

  it('asks to remove a recent workspace from the list', () => {
    const { onRemoveWorkspace, api } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remover site dos recentes' }));
    expect(onRemoveWorkspace).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }));
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
  });

  it('confirms before launching when the default mode is dangerous', async () => {
    const risky = agentDef('claude');
    const agents = [{ ...risky, permission: { ...risky.permission!, default: 'bypass' } }];
    const { api } = setup(snapshot({ groups: WS }), agents, DETECT);
    fireEvent.click(within(recentList()).getByRole('button', { name: /^api/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/direto na pasta \/repos\/api e na máquina/);
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /lançar sem confirmações/i }));
    await waitFor(() =>
      expect(api.tasks.createAndLaunch.mock.calls[0]?.[0].picks).toEqual([
        { agentId: 'claude', model: 'sonnet', permission: 'bypass' },
      ]),
    );
  });

  it('disables launching without an installed agent', () => {
    setup(snapshot({ groups: WS }), AGENTS, {});
    expect((screen.getByRole('button', { name: /novo terminal/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nenhum agente instalado/i)).toBeTruthy();
  });

  it('shows launch errors', async () => {
    const { api } = setup();
    api.tasks.createAndLaunch.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'LIMIT_REACHED', message: 'Há só 0 vaga(s).' } }),
    );
    fireEvent.click(within(recentList()).getByRole('button', { name: /^api/ }));
    expect(await screen.findByText('Há só 0 vaga(s).')).toBeTruthy();
  });
});
