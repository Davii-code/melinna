import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ModelSelect } from '../../../src/renderer/components/ModelSelect';
import type { AgentDefinition, Execution, SwitchPlan } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { agentDef, execution, shellDef } from '../../support/renderer-fixtures';

function setup(plan: SwitchPlan, exec: Execution = execution('e1'), agent: AgentDefinition = agentDef('claude')) {
  const api = fakeApi();
  api.executions.requestSwitch.mockImplementation(() => okR(plan));
  const view = render(
    <ApiContext.Provider value={api}>
      <ModelSelect execution={exec} agent={agent} />
    </ApiContext.Provider>,
  );
  return { api, view };
}

const select = () => screen.getByRole('combobox', { name: /modelo/i }) as HTMLSelectElement;

describe('ModelSelect', () => {
  it('lists the catalog models with the current one selected', () => {
    setup({ planId: 'p', kind: 'pty-command', waitsForIdle: false, dangerous: false });
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual(['Sonnet', 'Opus', 'Personalizado…']);
    expect(select().value).toBe('sonnet');
  });

  it('switches by command right away when the agent is idle', async () => {
    const { api } = setup({ planId: 'p1', kind: 'pty-command', waitsForIdle: false, dangerous: false });
    fireEvent.change(select(), { target: { value: 'opus' } });
    await waitFor(() => expect(api.executions.confirmSwitch).toHaveBeenCalledWith('e1', 'p1'));
    expect(api.executions.requestSwitch).toHaveBeenCalledWith('e1', 'model', 'opus');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('shows the pending switch and lets the user cancel it', async () => {
    const { api } = setup(
      { planId: 'p1', kind: 'pty-command', waitsForIdle: true, dangerous: false },
      execution('e1', { pendingSwitch: { kind: 'model', value: 'opus' } }),
    );
    expect(screen.getByText(/trocar para Opus ao ficar ocioso/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /cancelar troca/i }));
    await waitFor(() => expect(api.executions.cancelPendingSwitch).toHaveBeenCalledWith('e1'));
  });

  it('asks before relaunching with resume and mentions the interrupted response', async () => {
    const { api } = setup({ planId: 'p2', kind: 'restart-resume', interruptsResponse: true, dangerous: false });
    fireEvent.change(select(), { target: { value: 'opus' } });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/encerrar e relançar.*retomando a conversa/i);
    expect(dialog.textContent).toMatch(/resposta em andamento será interrompida/i);
    expect(api.executions.confirmSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /relançar/i }));
    await waitFor(() => expect(api.executions.confirmSwitch).toHaveBeenCalledWith('e1', 'p2'));
  });

  it('warns that the conversation will be lost when the agent cannot switch', async () => {
    const { api } = setup({
      planId: 'p3',
      kind: 'restart-fresh',
      losesConversation: true,
      interruptsResponse: false,
      dangerous: false,
    });
    fireEvent.change(select(), { target: { value: 'opus' } });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/conversa atual será perdida/i);
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.executions.confirmSwitch).not.toHaveBeenCalled();
    expect(select().value).toBe('sonnet');
    fireEvent.change(select(), { target: { value: 'opus' } });
    fireEvent.click(await screen.findByRole('button', { name: /relançar com o novo modelo/i }));
    await waitFor(() => expect(api.executions.confirmSwitch).toHaveBeenCalledWith('e1', 'p3'));
  });

  it('validates a custom model before applying', async () => {
    const { api } = setup({ planId: 'p4', kind: 'pty-command', waitsForIdle: false, dangerous: false });
    fireEvent.change(select(), { target: { value: '__custom__' } });
    const input = screen.getByRole('textbox', { name: /modelo personalizado/i });
    const apply = screen.getByRole('button', { name: /aplicar/i }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: 'nome inválido!' } });
    expect(apply.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'claude-x-1' } });
    fireEvent.click(apply);
    await waitFor(() => expect(api.executions.requestSwitch).toHaveBeenCalledWith('e1', 'model', 'claude-x-1'));
  });

  it('shows errors from the main process and is disabled when not running', async () => {
    const api = fakeApi();
    api.executions.requestSwitch.mockImplementation(() =>
      Promise.resolve({ ok: false, error: { code: 'INPUT_INVALID', message: 'O modelo x não está na lista.' } }),
    );
    render(
      <ApiContext.Provider value={api}>
        <ModelSelect execution={execution('e1')} agent={agentDef('claude')} />
        <ModelSelect execution={execution('e2', { status: 'exited' })} agent={agentDef('claude')} />
      </ApiContext.Provider>,
    );
    const [live, ended] = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(ended?.disabled).toBe(true);
    fireEvent.change(live!, { target: { value: 'opus' } });
    expect(await screen.findByText('O modelo x não está na lista.')).toBeTruthy();
  });

  it('renders nothing for agents without models', () => {
    const { view } = setup(
      { planId: 'p', kind: 'pty-command', waitsForIdle: false, dangerous: false },
      execution('e1', { model: null }),
      shellDef('bash'),
    );
    expect(view.container.textContent).toBe('');
  });
});
