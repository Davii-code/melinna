import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { greeting, Home } from '../../../src/renderer/components/Home/Home';
import type { Group, WorkspaceSnapshot } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { agentDef, shellDef } from '../../support/renderer-fixtures';

const WS: Group[] = [
  { id: 'w1', name: 'site', order: 0, repoPath: '/repos/site', colorIndex: 0, lastOpenedAt: '2026-10-20T10:00:00.000Z' },
  { id: 'w2', name: 'api', order: 1, repoPath: '/repos/api', colorIndex: 1, lastOpenedAt: '2026-10-21T08:00:00.000Z' },
  { id: 'g3', name: 'Só grupo', order: 2 },
];

function setup(snap: WorkspaceSnapshot = snapshot({ groups: WS })) {
  const api = fakeApi();
  const onLaunched = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <Home
        snapshot={snap}
        agents={[
          agentDef('claude'),
          agentDef('codex', { displayName: 'Codex CLI' }),
          shellDef('bash', 'Git Bash'),
        ]}
        detect={{
          claude: { installed: true, searched: 'claude' },
          codex: { installed: false, searched: 'codex' },
          bash: { installed: true, searched: 'bash' },
        }}
        size={{ cols: 100, rows: 30 }}
        now={new Date('2026-10-21T09:20:00')}
        onLaunched={onLaunched}
      />
    </ApiContext.Provider>,
  );
  return { api, onLaunched };
}

const prompt = () => screen.getByRole('textbox', { name: /o que você quer construir/i });

describe('greeting', () => {
  it('follows the time of day', () => {
    expect(greeting(new Date('2026-01-01T07:00:00'))).toBe('Bom dia');
    expect(greeting(new Date('2026-01-01T13:00:00'))).toBe('Boa tarde');
    expect(greeting(new Date('2026-01-01T20:00:00'))).toBe('Boa noite');
    expect(greeting(new Date('2026-01-01T03:00:00'))).toBe('Boa noite');
  });
});

describe('Home', () => {
  it('greets with the avatar and lists only installed agents', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Bom dia' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /melinna/i })).toBeTruthy();
    const agents = screen.getByRole('combobox', { name: 'Agente' }) as HTMLSelectElement;
    expect(Array.from(agents.options).map((o) => o.textContent)).toEqual(['Claude Code', 'Git Bash']);
    expect(agents.value).toBe('claude');
  });

  it('selects the most recent workspace and shows recent workspaces as cards', () => {
    setup();
    const ws = screen.getByRole('combobox', { name: 'Workspace' }) as HTMLSelectElement;
    expect(ws.value).toBe('w2');
    expect(Array.from(ws.options).map((o) => o.textContent)).toEqual(['api', 'site', 'Abrir pasta…']);
    const recent = screen.getByRole('list', { name: /workspaces recentes/i });
    expect(within(recent).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('/repos/api'),
      expect.stringContaining('/repos/site'),
    ]);
    fireEvent.click(within(recent).getByRole('button', { name: /site/ }));
    expect(ws.value).toBe('w1');
  });

  it('launches the agent with the prompt in the selected workspace', async () => {
    const { api, onLaunched } = setup();
    fireEvent.change(prompt(), { target: { value: 'Crie a página de login' } });
    fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.workspace.inspectRepo).toHaveBeenCalledWith('/repos/api', 'HEAD');
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toEqual({
      groupId: 'w2',
      repoPath: '/repos/api',
      baseRef: 'HEAD',
      prompt: 'Crie a página de login',
      picks: [{ agentId: 'claude', model: 'sonnet', permission: 'manual' }],
      size: { cols: 100, rows: 30 },
    });
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
  });

  it('Enter sends and Shift+Enter breaks the line', async () => {
    const { api } = setup();
    fireEvent.change(prompt(), { target: { value: 'linha' } });
    fireEvent.keyDown(prompt(), { key: 'Enter', shiftKey: true });
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
    fireEvent.keyDown(prompt(), { key: 'Enter' });
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
  });

  it('"Novo terminal" opens the chosen agent or shell without a prompt', async () => {
    const { api } = setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Agente' }), { target: { value: 'bash' } });
    expect(screen.queryByRole('combobox', { name: 'Modo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toMatchObject({ prompt: '', picks: [{ agentId: 'bash' }] });
  });

  it('opens a folder as a workspace and selects it', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('button', { name: /abrir workspace/i }));
    await waitFor(() => expect(api.workspace.openWorkspace).toHaveBeenCalledWith('/escolhido'));
  });

  it('asks for a folder when there is no workspace yet', async () => {
    const { api } = setup(snapshot());
    expect(screen.getByText(/abra uma pasta para começar/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    await waitFor(() => expect(api.workspace.pickRepository).toHaveBeenCalled());
    await waitFor(() => expect(api.workspace.openWorkspace).toHaveBeenCalledWith('/escolhido'));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toMatchObject({ groupId: 'ws-new', repoPath: '/escolhido' });
  });

  it('warns about uncommitted changes before launching', async () => {
    const { api } = setup();
    api.workspace.inspectRepo.mockImplementation(() => okR({ root: '/repos/api', baseCommit: 'a'.repeat(40), uncommittedCount: 3 }));
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/3 alterações não commitadas/);
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /lançar mesmo assim/i }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
  });

  it('confirms a dangerous mode before launching', async () => {
    const { api } = setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Modo' }), { target: { value: 'bypass' } });
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/não a máquina/);
    fireEvent.click(screen.getByRole('button', { name: /lançar sem confirmações/i }));
    await waitFor(() =>
      expect(api.tasks.createAndLaunch.mock.calls[0]?.[0].picks).toEqual([
        { agentId: 'claude', model: 'sonnet', permission: 'bypass' },
      ]),
    );
  });

  it('shows launch errors', async () => {
    const { api } = setup();
    api.tasks.createAndLaunch.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'LIMIT_REACHED', message: 'Há só 0 vaga(s).' } }),
    );
    fireEvent.click(screen.getByRole('button', { name: /novo terminal/i }));
    expect(await screen.findByText('Há só 0 vaga(s).')).toBeTruthy();
  });
});
