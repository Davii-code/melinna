import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { PermissionSelect } from '../../../src/renderer/components/PermissionSelect';
import type { SwitchPlan } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { agentDef, execution } from '../../support/renderer-fixtures';

function setup(plan: SwitchPlan) {
  const api = fakeApi();
  api.executions.requestSwitch.mockImplementation(() => okR(plan));
  render(
    <ApiContext.Provider value={api}>
      <PermissionSelect execution={execution('e1')} agent={agentDef('claude')} />
    </ApiContext.Provider>,
  );
  return api;
}

const select = () => screen.getByRole('combobox', { name: /modo de permissão/i }) as HTMLSelectElement;

describe('PermissionSelect', () => {
  it('lists the modes marking the dangerous ones', () => {
    setup({ planId: 'p', kind: 'pty-command', waitsForIdle: false, dangerous: false });
    expect(Array.from(select().options).map((o) => o.textContent)).toEqual(['Perguntar', '⚠ Sem confirmações']);
    expect(select().value).toBe('manual');
  });

  it('requires explicit confirmation for a dangerous mode, explaining the isolation limits', async () => {
    const api = setup({ planId: 'p1', kind: 'pty-command', waitsForIdle: false, dangerous: true });
    fireEvent.change(select(), { target: { value: 'bypass' } });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/isola apenas os arquivos do repositório, não a máquina/i);
    expect(api.executions.confirmSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /desligar confirmações/i }));
    await waitFor(() => expect(api.executions.confirmSwitch).toHaveBeenCalledWith('e1', 'p1'));
    expect(api.executions.requestSwitch).toHaveBeenCalledWith('e1', 'permission', 'bypass');
  });

  it('combines the restart and the danger warnings in one confirmation', async () => {
    const api = setup({ planId: 'p2', kind: 'restart-resume', interruptsResponse: false, dangerous: true });
    fireEvent.change(select(), { target: { value: 'bypass' } });
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toMatch(/retomando a conversa/i);
    expect(dialog.textContent).toMatch(/não a máquina/i);
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(api.executions.confirmSwitch).not.toHaveBeenCalled();
  });
});
