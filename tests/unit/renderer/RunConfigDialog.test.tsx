import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import {
  RunConfigDialog,
  type RunConfigDialogProps,
} from '../../../src/renderer/components/Run/RunConfigDialog';
import type { Group, RunCommand } from '../../../src/shared/ipc-contract';
import { fakeApi } from '../../support/fake-api';
import { runCommand } from '../../support/renderer-fixtures';

const groups: Group[] = [
  {
    id: 'g1',
    name: 'App',
    order: 0,
    folders: [
      { id: 'f1', path: '/repo' },
      { id: 'f2', path: '/repo/api' },
    ],
    primaryFolderId: 'f1',
  },
  { id: 'g2', name: 'Outro', order: 1, folders: [{ id: 'f3', path: '/other' }], primaryFolderId: 'f3' },
];

const custom = (over: Partial<RunCommand> = {}) =>
  runCommand({
    id: 'c-custom',
    source: 'custom',
    tool: 'custom',
    label: 'Servidor',
    program: 'node',
    args: ['server.js', '--porta', '3000'],
    ...over,
  });

function setup(
  commands: RunCommand[] = [custom(), runCommand({ id: 'c-dev', label: 'dev' })],
  over: Partial<RunConfigDialogProps> = {},
) {
  const api = fakeApi();
  const props: RunConfigDialogProps = {
    catalog: { commands, warnings: [] },
    groups,
    initialSelection: null,
    onChanged: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(
    <ApiContext.Provider value={api}>
      <RunConfigDialog {...props} />
    </ApiContext.Provider>,
  );
  return { api, ...props };
}

const dialog = () => screen.getByRole('dialog', { name: 'Configurações de execução' });
const item = (name: RegExp | string) => within(dialog()).getByRole('option', { name });
const field = (name: string) => within(dialog()).getByRole('textbox', { name }) as HTMLInputElement;
const button = (name: string | RegExp) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;

describe('RunConfigDialog — lista e campos', () => {
  it('lists the configurations on the left and shows the fields of the chosen one on the right', () => {
    setup();
    expect(within(dialog()).getByRole('listbox', { name: 'Configurações' })).toBeTruthy();
    expect(within(dialog()).getByText('App')).toBeTruthy();
    fireEvent.click(item(/Servidor/));
    expect(field('Nome').value).toBe('Servidor');
    expect(field('Programa').value).toBe('node');
    expect((within(dialog()).getByRole('combobox', { name: 'Pasta' }) as HTMLSelectElement).value).toBe(
      '/repo',
    );
  });

  it('shows the arguments as a list of fields, one per item', () => {
    setup();
    fireEvent.click(item(/Servidor/));
    expect(field('Argumento 1').value).toBe('server.js');
    expect(field('Argumento 2').value).toBe('--porta');
    expect(field('Argumento 3').value).toBe('3000');
  });

  it('adds, edits and removes arguments without joining them into one text', async () => {
    const { api } = setup();
    fireEvent.click(item(/Servidor/));
    fireEvent.change(field('Argumento 3'), { target: { value: '4000' } });
    fireEvent.click(button('Remover argumento 1'));
    fireEvent.click(button('Adicionar argumento'));
    fireEvent.change(field('Argumento 3'), { target: { value: 'dois espaços' } });
    fireEvent.click(button('Salvar'));
    await waitFor(() => expect(api.run.saveCommand).toHaveBeenCalled());
    expect(api.run.saveCommand).toHaveBeenCalledWith('g1', {
      id: 'c-custom',
      label: 'Servidor',
      program: 'node',
      args: ['--porta', '4000', 'dois espaços'],
      folder: '/repo',
    });
  });
});

describe('RunConfigDialog — criar, editar, duplicar, excluir', () => {
  it('creates a configuration in the chosen workspace and folder', async () => {
    const { api, onChanged } = setup();
    fireEvent.click(button('Nova configuração'));
    expect(button('Salvar').disabled).toBe(true);
    fireEvent.change(field('Nome'), { target: { value: 'Tudo' } });
    fireEvent.change(field('Programa'), { target: { value: 'docker' } });
    fireEvent.click(button('Adicionar argumento'));
    fireEvent.change(field('Argumento 1'), { target: { value: 'compose' } });
    fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Workspace' }), {
      target: { value: 'g2' },
    });
    expect((within(dialog()).getByRole('combobox', { name: 'Pasta' }) as HTMLSelectElement).value).toBe(
      '/other',
    );
    fireEvent.click(button('Salvar'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.run.saveCommand).toHaveBeenCalledWith('g2', {
      label: 'Tudo',
      program: 'docker',
      args: ['compose'],
      folder: '/other',
    });
  });

  it('edits an existing custom configuration keeping its id', async () => {
    const { api } = setup();
    fireEvent.click(item(/Servidor/));
    fireEvent.change(field('Nome'), { target: { value: 'API' } });
    fireEvent.click(button('Salvar'));
    await waitFor(() => expect(api.run.saveCommand).toHaveBeenCalled());
    expect(api.run.saveCommand.mock.calls[0]?.[1]).toMatchObject({ id: 'c-custom', label: 'API' });
  });

  it('duplicates suggesting "<name> (cópia)" and saves it as a new configuration', async () => {
    const { api } = setup();
    fireEvent.click(item(/Servidor/));
    fireEvent.click(button('Duplicar'));
    expect(field('Nome').value).toBe('Servidor (cópia)');
    expect(field('Programa').value).toBe('node');
    expect(field('Argumento 1').value).toBe('server.js');
    fireEvent.click(button('Salvar'));
    await waitFor(() => expect(api.run.saveCommand).toHaveBeenCalled());
    const [, sent] = api.run.saveCommand.mock.calls[0] ?? [];
    expect(sent).toEqual({
      label: 'Servidor (cópia)',
      program: 'node',
      args: ['server.js', '--porta', '3000'],
      folder: '/repo',
    });
    expect(sent).not.toHaveProperty('id');
  });

  it('numbers the copy when the suggested name is already taken', () => {
    setup([
      custom(),
      custom({ id: 'c2', label: 'Servidor (cópia)' }),
      custom({ id: 'c3', label: 'Servidor (cópia 2)' }),
    ]);
    fireEvent.click(item(/^Servidor$/));
    fireEvent.click(button('Duplicar'));
    expect(field('Nome').value).toBe('Servidor (cópia 3)');
  });

  it('deletes a custom configuration', async () => {
    const { api, onChanged } = setup();
    fireEvent.click(item(/Servidor/));
    fireEvent.click(button('Excluir'));
    await waitFor(() => expect(api.run.removeCommand).toHaveBeenCalledWith('g1', 'c-custom'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('shows "Pare o comando antes." when the configuration is running', async () => {
    const { api, onChanged } = setup();
    api.run.removeCommand.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'EXECUTION_RUNNING' as const, message: 'Pare o comando antes.' },
      }),
    );
    fireEvent.click(item(/Servidor/));
    fireEvent.click(button('Excluir'));
    expect((await within(dialog()).findByRole('alert')).textContent).toBe('Pare o comando antes.');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows the error returned by the save', async () => {
    const { api } = setup();
    api.run.saveCommand.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'A pasta precisa ser do workspace.' },
      }),
    );
    fireEvent.click(item(/Servidor/));
    fireEvent.change(field('Nome'), { target: { value: 'Outro nome' } });
    fireEvent.click(button('Salvar'));
    expect((await within(dialog()).findByRole('alert')).textContent).toBe(
      'A pasta precisa ser do workspace.',
    );
  });

  it('opens already on the requested configuration', () => {
    setup(undefined, { initialSelection: { groupId: 'g1', commandId: 'c-custom' } });
    expect(field('Nome').value).toBe('Servidor');
  });
});

describe('RunConfigDialog — detectadas', () => {
  it('shows a detected configuration read-only and offers to duplicate it', () => {
    setup();
    fireEvent.click(item(/dev/));
    expect(field('Nome').disabled).toBe(true);
    expect(field('Programa').disabled).toBe(true);
    expect(field('Argumento 1').disabled).toBe(true);
    expect(within(dialog()).queryByRole('button', { name: 'Salvar' })).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(within(dialog()).queryByRole('button', { name: 'Adicionar argumento' })).toBeNull();
    expect(within(dialog()).getByText(/somente leitura/i)).toBeTruthy();
    expect(button('Duplicar').disabled).toBe(false);
  });

  it('duplicates a detected configuration into an editable custom one', async () => {
    const { api } = setup();
    fireEvent.click(item(/dev/));
    fireEvent.click(button('Duplicar'));
    expect(field('Nome').value).toBe('dev (cópia)');
    expect(field('Nome').disabled).toBe(false);
    fireEvent.click(button('Salvar'));
    await waitFor(() =>
      expect(api.run.saveCommand).toHaveBeenCalledWith('g1', {
        label: 'dev (cópia)',
        program: 'npm',
        args: ['run', 'dev'],
        folder: '/repo',
      }),
    );
  });
});

describe('RunConfigDialog — validações', () => {
  it('requires a name and a program', () => {
    setup();
    fireEvent.click(item(/Servidor/));
    fireEvent.change(field('Nome'), { target: { value: '   ' } });
    expect(button('Salvar').disabled).toBe(true);
    fireEvent.change(field('Nome'), { target: { value: 'Ok' } });
    expect(button('Salvar').disabled).toBe(false);
    fireEvent.change(field('Programa'), { target: { value: '' } });
    expect(button('Salvar').disabled).toBe(true);
  });

  it('refuses a repeated name in the workspace regardless of case, but not its own', () => {
    setup([custom(), custom({ id: 'c2', label: 'API' })]);
    fireEvent.click(item(/^Servidor$/));
    expect(button('Salvar').disabled).toBe(false);
    fireEvent.change(field('Nome'), { target: { value: 'api' } });
    expect(within(dialog()).getByText('Já existe uma configuração com esse nome.')).toBeTruthy();
    expect(button('Salvar').disabled).toBe(true);
    fireEvent.change(field('Nome'), { target: { value: 'servidor' } });
    expect(button('Salvar').disabled).toBe(false);
  });

  it('limits the name to 80 characters and the arguments to 64', () => {
    setup();
    fireEvent.click(item(/Servidor/));
    expect(field('Nome').maxLength).toBe(80);
    for (let i = 0; i < 70; i++) fireEvent.click(button('Adicionar argumento'));
    expect(within(dialog()).getAllByRole('textbox', { name: /^Argumento \d+$/ })).toHaveLength(64);
    expect(button('Adicionar argumento').disabled).toBe(true);
  });

  it('closes with the close button and with Escape', () => {
    const { onClose } = setup();
    fireEvent.click(button('Fechar'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
