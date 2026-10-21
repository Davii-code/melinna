import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { NewTaskDialog } from '../../../src/renderer/components/NewTaskDialog';
import { fakeApi, snapshot } from '../../support/fake-api';
import { agentDef, shellDef } from '../../support/renderer-fixtures';

function setup() {
  const api = fakeApi();
  const agents = [
    agentDef('claude'),
    agentDef('codex', { displayName: 'Codex CLI' }),
    shellDef('bash', 'Git Bash'),
  ];
  render(
    <ApiContext.Provider value={api}>
      <NewTaskDialog
        snapshot={snapshot({ groups: [{ id: 'g1', name: 'Grupo', order: 0 }] })}
        agents={agents}
        detect={{
          claude: { installed: true, searched: 'claude' },
          codex: { installed: true, searched: 'codex' },
          bash: { installed: true, searched: 'bash' },
        }}
        size={{ cols: 100, rows: 30 }}
        onClose={vi.fn()}
        onLaunched={vi.fn()}
      />
    </ApiContext.Provider>,
  );
  fireEvent.change(screen.getByLabelText('Pasta'), { target: { value: '/repo' } });
  fireEvent.change(screen.getByLabelText('Enunciado'), { target: { value: 'Faça X' } });
  return api;
}

describe('NewTaskDialog: modelo, modo e título em "Avançado"', () => {
  it('sends the model, mode and title chosen in "Avançado"', async () => {
    const api = setup();
    fireEvent.change(screen.getByLabelText('Agente'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: '__custom__' } });
    fireEvent.change(screen.getByLabelText('Modelo personalizado'), { target: { value: 'gpt-x' } });
    fireEvent.change(screen.getByLabelText('Título (opcional)'), { target: { value: 'Login' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    await waitFor(() => expect(api.tasks.createAndLaunch).toHaveBeenCalled());
    expect(api.tasks.createAndLaunch.mock.calls[0]?.[0]).toMatchObject({
      title: 'Login',
      picks: [{ agentId: 'codex', model: 'gpt-x', permission: 'manual' }],
    });
  });

  it('resets model and mode to the defaults of the newly chosen agent and hides them for a shell', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: 'opus' } });
    fireEvent.change(screen.getByLabelText('Agente'), { target: { value: 'codex' } });
    expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('sonnet');
    fireEvent.change(screen.getByLabelText('Agente'), { target: { value: 'bash' } });
    expect(screen.queryByLabelText('Modelo')).toBeNull();
    expect(screen.queryByLabelText('Modo de permissão')).toBeNull();
  });

  it('asks for confirmation before launching with a dangerous mode', async () => {
    const api = setup();
    fireEvent.change(screen.getByLabelText('Modo de permissão'), { target: { value: 'bypass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lançar' }));
    const confirm = await screen.findByRole('alertdialog', { name: /modo sem confirmações/i });
    expect(confirm.textContent).toMatch(/Claude Code: Sem confirmações/);
    expect(confirm.textContent).toMatch(/direto na pasta \/repo e na máquina/);
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
    fireEvent.change(screen.getByLabelText('Modelo'), { target: { value: '__custom__' } });
    fireEvent.change(screen.getByLabelText('Modelo personalizado'), { target: { value: 'com espaço' } });
    expect((screen.getByRole('button', { name: 'Lançar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nome de modelo inválido/i)).toBeTruthy();
  });
});
