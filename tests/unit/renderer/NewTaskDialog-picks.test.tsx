import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { NewTaskDialog } from '../../../src/renderer/components/NewTaskDialog';
import { fakeApi, snapshot } from '../../support/fake-api';
import { agentDef } from '../../support/renderer-fixtures';

function setup() {
  const api = fakeApi();
  const agents = [agentDef('claude'), agentDef('codex', { displayName: 'Codex CLI' })];
  render(
    <ApiContext.Provider value={api}>
      <NewTaskDialog
        snapshot={snapshot({ groups: [{ id: 'g1', name: 'Grupo', order: 0 }] })}
        agents={agents}
        detect={{
          claude: { installed: true, searched: 'claude' },
          codex: { installed: true, searched: 'codex' },
        }}
        size={{ cols: 100, rows: 30 }}
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />
    </ApiContext.Provider>,
  );
  fireEvent.change(screen.getByPlaceholderText(/caminho de um repositório/i), { target: { value: '/repo' } });
  fireEvent.change(screen.getByPlaceholderText(/o que os agentes devem fazer/i), { target: { value: 'Faça X' } });
  return api;
}

describe('NewTaskDialog: modelo e modo por agente', () => {
  it('sends the model and mode chosen for each agent', async () => {
    const api = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Codex CLI' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Modelo de Claude Code' }), { target: { value: 'opus' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Modelo de Codex CLI' }), { target: { value: '__custom__' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Modelo personalizado de Codex CLI' }), {
      target: { value: 'gpt-x' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0].picks).toEqual([
      { agentId: 'claude', model: 'opus', permission: 'manual' },
      { agentId: 'codex', model: 'gpt-x', permission: 'manual' },
    ]);
  });

  it('asks for confirmation before launching with a dangerous mode', async () => {
    const api = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Modo de permissão de Claude Code' }), {
      target: { value: 'bypass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    const confirm = await screen.findByRole('alertdialog', { name: /modo sem confirmações/i });
    expect(confirm.textContent).toMatch(/Claude Code: Sem confirmações/);
    expect(confirm.textContent).toMatch(/não a máquina/);
    expect(api.tasks.createAndLaunch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /lançar sem confirmações/i }));
    await waitFor(() =>
      expect(api.tasks.createAndLaunch.mock.calls[0]?.[0].picks).toEqual([
        { agentId: 'claude', model: 'sonnet', permission: 'bypass' },
      ]),
    );
  });

  it('blocks an invalid custom model', () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Claude Code' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Modelo de Claude Code' }), { target: { value: '__custom__' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Modelo personalizado de Claude Code' }), {
      target: { value: 'com espaço' },
    });
    expect((screen.getByRole('button', { name: 'Lançar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nome de modelo inválido/i)).toBeTruthy();
  });
});
