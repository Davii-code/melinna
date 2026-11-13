import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import {
  AutomationsDialog,
  describeRun,
  describeSchedule,
} from '../../../src/renderer/components/Automations/AutomationsDialog';
import type { AutomationView } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { agentDef } from '../../support/renderer-fixtures';

const AGENTS = [agentDef('claude'), agentDef('codex')];

const VIEW: AutomationView = {
  id: 'a1',
  name: 'Atualizar dependências',
  folder: '/repos/site',
  agentId: 'claude',
  prompt: 'Atualize as dependências.',
  schedule: { kind: 'daily', time: '02:00', days: [1, 3] },
  enabled: true,
  isolation: 'worktree',
  createdAt: '2026-03-01T10:00:00.000Z',
  lastRun: {
    at: '2026-03-02T05:00:00.000Z',
    status: 'failed',
    detail: 'Limite de 12 execuções vivas atingido.',
  },
  nextRunAt: '2026-03-04T05:00:00.000Z',
};

function setup(automations: AutomationView[] = [VIEW], readOnly = false) {
  const api = fakeApi();
  api.automations.list.mockImplementation(() => okR({ automations, readOnly }));
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <AutomationsDialog agents={AGENTS} onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onClose };
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('describeSchedule and describeRun', () => {
  it('describes daily and interval schedules', () => {
    expect(describeSchedule({ kind: 'daily', time: '09:00', days: [] })).toBe('Todo dia às 09:00');
    expect(describeSchedule({ kind: 'daily', time: '18:30', days: [1, 5] })).toBe('Seg, Sex às 18:30');
    expect(describeSchedule({ kind: 'interval', minutes: 45 })).toBe('A cada 45 min');
    expect(describeSchedule({ kind: 'interval', minutes: 120 })).toBe('A cada 2 h');
  });

  it('describes the last run', () => {
    expect(describeRun(null)).toBe('Ainda não disparou');
    expect(describeRun({ at: '2026-03-02T05:00:00.000Z', status: 'launched' })).toMatch(/^Disparou em /);
    expect(describeRun({ at: 'x', status: 'missed', detail: '2026-03-02T05:00:00.000Z' })).toMatch(
      /^Perdida em /,
    );
    expect(describeRun({ at: '2026-03-02T05:00:00.000Z', status: 'failed', detail: 'sem vaga' })).toMatch(
      /^Falhou em .*: sem vaga$/,
    );
  });
});

describe('AutomationsDialog', () => {
  it('lists each automation with schedule, agent, folder, last and next run', async () => {
    setup();
    const item = await screen.findByTestId('automation-a1');
    expect(item.textContent).toContain('Atualizar dependências');
    expect(item.textContent).toContain('Seg, Qua às 02:00 · Claude Code · /repos/site');
    expect(item.textContent).toMatch(/Falhou em .*Limite de 12 execuções/);
    expect(item.textContent).toContain('Próximo disparo:');
    expect((within(item).getByLabelText('Ligar Atualizar dependências') as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('says that automations only run with the app open and shows the empty state', async () => {
    setup([]);
    expect(await screen.findByText('Nenhuma automação ainda.')).toBeTruthy();
    expect(screen.getByText(/Só dispara com o app aberto/)).toBeTruthy();
  });

  it('creates a daily automation with the chosen days', async () => {
    const { api } = setup([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Nova automação' }));
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field('Nome'), { target: { value: 'Relatório' } });
    fireEvent.change(field('Pasta'), { target: { value: '/repos/site' } });
    fireEvent.change(field('Enunciado'), { target: { value: 'Gere o relatório.' } });
    fireEvent.change(field('Agente'), { target: { value: 'codex' } });
    fireEvent.change(field('Horário'), { target: { value: '07:15' } });
    fireEvent.click(field('Sex'));
    fireEvent.click(field('Seg'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api.automations.save).toHaveBeenCalledTimes(1));
    expect(api.automations.save.mock.calls[0]?.[0]).toEqual({
      name: 'Relatório',
      folder: '/repos/site',
      agentId: 'codex',
      prompt: 'Gere o relatório.',
      enabled: true,
      isolation: 'direct',
      schedule: { kind: 'daily', time: '07:15', days: [1, 5] },
    });
    await waitFor(() => expect(screen.queryByLabelText('Nome')).toBeNull());
  });

  it('edits an automation as an interval in a worktree, keeping its id', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(field('Nome').value).toBe('Atualizar dependências');
    expect(field('Isolar em um worktree git').checked).toBe(true);
    fireEvent.change(field('Quando'), { target: { value: 'interval' } });
    const save = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement;
    fireEvent.change(field('Intervalo em minutos'), { target: { value: '2' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(field('Intervalo em minutos'), { target: { value: '90' } });
    fireEvent.click(save);
    await waitFor(() => expect(api.automations.save).toHaveBeenCalledTimes(1));
    expect(api.automations.save.mock.calls[0]?.[0]).toMatchObject({
      id: 'a1',
      isolation: 'worktree',
      schedule: { kind: 'interval', minutes: 90 },
    });
  });

  it('picks the folder with the native dialog', async () => {
    const { api } = setup([]);
    api.workspace.pickRepository.mockImplementation(() => okR('/escolhida'));
    fireEvent.click(await screen.findByRole('button', { name: 'Nova automação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Escolher…' }));
    await waitFor(() => expect(field('Pasta').value).toBe('/escolhida'));
  });

  it('keeps the form and shows the reason when saving fails', async () => {
    const { api } = setup();
    api.automations.save.mockImplementation(
      () =>
        Promise.resolve({
          ok: false,
          error: { code: 'INPUT_INVALID', message: 'Horário inválido: use HH:MM.' },
        }) as never,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Horário inválido: use HH:MM.');
    expect(field('Nome').value).toBe('Atualizar dependências');
  });

  it('toggles, runs now and removes from the list', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByLabelText('Ligar Atualizar dependências'));
    await waitFor(() => expect(api.automations.setEnabled).toHaveBeenCalledWith('a1', false));
    fireEvent.click(screen.getByRole('button', { name: 'Rodar agora' }));
    await waitFor(() => expect(api.automations.runNow).toHaveBeenCalledWith('a1'));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() => expect(api.automations.remove).toHaveBeenCalledWith('a1'));
  });

  it('reloads when the automations change in the main process', async () => {
    const { api } = setup();
    await screen.findByTestId('automation-a1');
    const calls = api.automations.list.mock.calls.length;
    act(() => api.emitAutomationsChanged());
    await waitFor(() => expect(api.automations.list.mock.calls.length).toBe(calls + 1));
  });

  it('warns when the file is read-only and keeps an uninstalled agent visible', async () => {
    setup([{ ...VIEW, agentId: 'gemini' }], true);
    const item = await screen.findByTestId('automation-a1');
    expect(item.textContent).toContain('gemini (não instalado)');
    expect(screen.getByText(/versão mais nova do app/)).toBeTruthy();
  });

  it('closes', async () => {
    const { onClose } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
