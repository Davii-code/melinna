/*
 * Cenários migrados de RunConfigDialog.test.tsx (substituído pela janela da 009):
 * - lista à esquerda e campos da escolhida à direita → "lista e formulário";
 * - abrir já na configuração pedida → "abre na configuração ativa";
 * - remover (com configuração viva recusada) → "Remover configuração";
 * - erro devolvido pelo salvamento aparece na janela → "erro do principal";
 * - fechar com o botão e com Esc → "Cancelar" e "Esc".
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { RunConfigsDialog } from '../../../src/renderer/components/Run/RunConfigsDialog';
import { createRunStore } from '../../../src/renderer/store/run-store';
import type { ActiveRunRef, Group, RunConfigView } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { runCommand, runConfig } from '../../support/renderer-fixtures';

const SIZE = { cols: 100, rows: 30 };

const group: Group = {
  id: 'g1',
  name: 'App',
  order: 0,
  folders: [
    { id: 'f1', path: '/repo' },
    { id: 'f2', path: '/repo/api' },
  ],
  primaryFolderId: 'f1',
};

interface Options {
  configs?: RunConfigView[];
  active?: ActiveRunRef | null;
  groups?: Group[];
}

async function setup(opts: Options = {}) {
  const configs = opts.configs ?? [
    runConfig({ id: 'a', name: 'dev', script: 'dev' }),
    runConfig({ id: 'b', name: 'build', script: 'build', order: 1 }),
  ];
  const api = fakeApi();
  api.run.list.mockImplementation(() =>
    okR({
      configs,
      detected: [
        runCommand({ id: 'd1', label: 'dev', args: ['run', 'dev'] }),
        runCommand({ id: 'd2', label: 'build', args: ['run', 'build'] }),
        runCommand({ id: 'd3', label: 'lint', args: ['run', 'lint'] }),
      ],
      warnings: [],
    }),
  );
  api.prefs.get.mockImplementation(() =>
    okR({ keymap: 'windows' as const, activeRun: opts.active ?? null, readOnly: false }),
  );
  const onError = vi.fn();
  const onClose = vi.fn();
  const open = vi.fn();
  const store = createRunStore({
    api,
    layout: { open },
    workspace: { get: () => snapshot({ groups: [group] }) },
    size: SIZE,
    onError,
  });
  await store.load();
  render(
    <ApiContext.Provider value={api}>
      <RunConfigsDialog
        store={store}
        groups={opts.groups ?? [group]}
        initialSelection={opts.active ?? null}
        onClose={onClose}
      />
    </ApiContext.Provider>,
  );
  return { api, store, onClose, open, onError };
}

const dialog = () => screen.getByRole('dialog', { name: 'Configurações de execução' });
const button = (name: string) => within(dialog()).getByRole('button', { name }) as HTMLButtonElement;
const treeItem = (name: string) => within(screen.getByRole('tree')).getByRole('treeitem', { name });
const field = (label: string) => within(dialog()).getByLabelText(label) as HTMLInputElement;

describe('RunConfigsDialog — lista e formulário', () => {
  it('shows the tree on the left and the fields of the chosen config on the right', async () => {
    await setup({ active: { groupId: 'g1', commandId: 'b' } });
    expect(treeItem('dev')).toBeTruthy();
    expect(treeItem('build').getAttribute('aria-selected')).toBe('true');
    expect(field('Nome').value).toBe('build');
  });

  it('opens on the active config and focuses it', async () => {
    await setup({ active: { groupId: 'g1', commandId: 'b' } });
    expect(document.activeElement).toBe(treeItem('build'));
  });

  it('says to pick or create one when nothing is selected', async () => {
    await setup();
    expect(screen.getByText('Escolha uma configuração ou crie uma nova.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('tree'));
  });

  it('selects another config by clicking it', async () => {
    await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.click(treeItem('build'));
    expect(field('Nome').value).toBe('build');
  });

  it('offers a Workspace picker only when there is more than one workspace', async () => {
    await setup();
    expect(within(dialog()).queryByLabelText('Workspace')).toBeNull();
  });
});

describe('RunConfigsDialog — Aplicar, OK e Cancelar', () => {
  it('Aplicar saves what changed and keeps the window open', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    expect(button('Aplicar').disabled).toBe(true);
    fireEvent.change(field('Nome'), { target: { value: 'dev local' } });
    expect(button('Aplicar').disabled).toBe(false);
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(api.run.saveConfig).toHaveBeenCalledTimes(1);
    expect(api.run.saveConfig).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ id: 'a', name: 'dev local', tool: 'npm', script: 'dev' }),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeTruthy();
  });

  it('OK saves and closes', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.change(field('Nome'), { target: { value: 'novo nome' } });
    await act(async () => {
      fireEvent.click(button('OK'));
    });
    expect(api.run.saveConfig).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('OK without changes closes without calling the main process', async () => {
    const { api, onClose } = await setup();
    await act(async () => {
      fireEvent.click(button('OK'));
    });
    expect(api.run.saveConfig).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar without changes closes right away', async () => {
    const { onClose } = await setup();
    fireEvent.click(button('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar with changes asks before discarding, and keeps editing on "Continuar editando"', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.change(field('Nome'), { target: { value: 'outro' } });
    fireEvent.click(button('Cancelar'));
    const ask = screen.getByRole('alertdialog');
    expect(ask.textContent).toContain('Descartar');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Continuar editando' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(field('Nome').value).toBe('outro');
    fireEvent.click(button('Cancelar'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.run.saveConfig).not.toHaveBeenCalled();
  });

  it('Esc behaves as Cancelar', async () => {
    const { onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc with pending changes asks first', async () => {
    const { onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.change(field('Nome'), { target: { value: 'x' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses to apply an invalid config and says why', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.change(field('Nome'), { target: { value: '' } });
    expect(button('Aplicar').disabled).toBe(true);
    expect(button('OK').disabled).toBe(true);
    expect(api.run.saveConfig).not.toHaveBeenCalled();
  });

  it('shows the error of the main process in the window and keeps it open', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    api.run.saveConfig.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'RUN_CONFIG_INVALID' as const, message: 'Já existe uma configuração com esse nome.' },
      }),
    );
    fireEvent.change(field('Nome'), { target: { value: 'build2' } });
    await act(async () => {
      fireEvent.click(button('OK'));
    });
    expect(within(dialog()).getByRole('alert').textContent).toContain(
      'Já existe uma configuração com esse nome.',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('refuses a "Antes de lançar" cycle on apply, showing the chain', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    api.run.saveConfig.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: {
          code: 'RUN_CONFIG_CYCLE' as const,
          message: '"Antes de lançar" forma um ciclo: dev → build → dev.',
        },
      }),
    );
    fireEvent.change(field('Antes de lançar'), { target: { value: 'b' } });
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(within(dialog()).getByRole('alert').textContent).toContain('dev → build → dev');
  });

  it('reloads the configs after applying, so the window shows what is saved', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.change(field('Nome'), { target: { value: 'dev2' } });
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(api.run.list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('RunConfigsDialog — árvore', () => {
  it('Adicionar configuração creates a blank config of the tool, selected, saved on Aplicar without id', async () => {
    const { api } = await setup();
    fireEvent.click(button('Adicionar configuração'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Programa' }));
    expect(field('Nome').value).toBe('Nova configuração');
    fireEvent.change(field('Nome'), { target: { value: 'Servidor' } });
    fireEvent.change(field('Programa'), { target: { value: 'node' } });
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    const [, input] = api.run.saveConfig.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).toMatchObject({ name: 'Servidor', tool: 'program', program: 'node', folder: '/repo' });
    expect(input).not.toHaveProperty('id');
  });

  it('Adicionar from a detected script fills tool, script and folder', async () => {
    const { api } = await setup();
    fireEvent.click(button('Adicionar configuração'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'lint (repo)' }));
    expect(field('Nome').value).toBe('lint');
    expect((field('Script') as unknown as HTMLSelectElement).value).toBe('lint');
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(api.run.saveConfig).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ name: 'lint', tool: 'npm', script: 'lint', folder: '/repo' }),
    );
  });

  it('Copiar configuração adds "<name> (cópia)" and saves it as a new config', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.click(button('Copiar configuração'));
    expect(field('Nome').value).toBe('dev (cópia)');
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    const [, input] = api.run.saveConfig.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).toMatchObject({ name: 'dev (cópia)', script: 'dev' });
    expect(input).not.toHaveProperty('id');
  });

  it('Remover configuração asks, and the removal happens on Aplicar', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.click(button('Remover configuração'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
    expect(within(screen.getByRole('tree')).queryByRole('treeitem', { name: 'dev' })).toBeNull();
    expect(api.run.removeConfig).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(api.run.removeConfig).toHaveBeenCalledWith('g1', 'a');
  });

  it('Cancelar restores a removed config', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.click(button('Remover configuração'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
    fireEvent.click(button('Cancelar'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Descartar' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.run.removeConfig).not.toHaveBeenCalled();
  });

  it('shows the error when the main process refuses to remove a running config', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    api.run.removeConfig.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'RUN_CONFIG_RUNNING' as const, message: 'A configuração está rodando. Pare-a antes.' },
      }),
    );
    fireEvent.click(button('Remover configuração'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(within(dialog()).getByRole('alert').textContent).toContain('Pare-a antes');
  });

  it('Nova pasta + Mover para pasta… saves folderGroup and order through run:reorder', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.click(button('Nova pasta'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da pasta' }), { target: { value: 'Web' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar pasta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de dev' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mover para pasta…' }));
    fireEvent.click(
      within(screen.getByRole('menu', { name: 'Pastas' })).getByRole('menuitem', { name: 'Web' }),
    );
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    expect(api.run.reorder).toHaveBeenCalledWith(
      'g1',
      expect.arrayContaining([expect.objectContaining({ id: 'a', folderGroup: 'Web' })]),
    );
  });

  it('Ordenar sorts alphabetically within each group', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    fireEvent.click(button('Ordenar'));
    await act(async () => {
      fireEvent.click(button('Aplicar'));
    });
    const [, items] = api.run.reorder.mock.calls[0] as [string, { id: string; order: number }[]];
    expect(items.find((i) => i.id === 'b')?.order).toBe(0);
    expect(items.find((i) => i.id === 'a')?.order).toBe(1);
  });
});

describe('RunConfigsDialog — Rodar', () => {
  it('applies, makes the config active, runs it and closes', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    api.run.start.mockImplementation(() => okR({ taskId: 't9', execId: 'e9', reused: false }));
    fireEvent.change(field('Nome'), { target: { value: 'dev 2' } });
    await act(async () => {
      fireEvent.click(button('Rodar'));
    });
    await waitFor(() => expect(api.run.start).toHaveBeenCalledWith('g1', 'a', SIZE, undefined));
    expect(api.run.saveConfig).toHaveBeenCalledTimes(1);
    expect(api.prefs.setActiveRun).toHaveBeenCalledWith({ groupId: 'g1', commandId: 'a' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not run when applying fails', async () => {
    const { api, onClose } = await setup({ active: { groupId: 'g1', commandId: 'a' } });
    api.run.saveConfig.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'RUN_CONFIG_INVALID' as const, message: 'Valor inválido.' },
      }),
    );
    fireEvent.change(field('Nome'), { target: { value: 'dev 2' } });
    await act(async () => {
      fireEvent.click(button('Rodar'));
    });
    expect(api.run.start).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('is disabled when the selected config is not available', async () => {
    await setup({
      configs: [runConfig({ id: 'a', name: 'dev', available: false, unavailableReason: 'program-missing' })],
      active: { groupId: 'g1', commandId: 'a' },
    });
    expect(button('Rodar').disabled).toBe(true);
  });
});

describe('RunConfigsDialog — vários workspaces', () => {
  it('lets the user pick the workspace and shows only its configs', async () => {
    const other: Group = {
      ...group,
      id: 'g2',
      name: 'Outro',
      order: 1,
      folders: [{ id: 'f3', path: '/other' }],
    };
    await setup({
      groups: [group, other],
      configs: [
        runConfig({ id: 'a', name: 'dev' }),
        runConfig({ id: 'z', name: 'servidor', groupId: 'g2', folder: '/other' }),
      ],
      active: { groupId: 'g1', commandId: 'a' },
    });
    const picker = within(dialog()).getByLabelText('Workspace') as HTMLSelectElement;
    expect(within(screen.getByRole('tree')).queryByRole('treeitem', { name: 'servidor' })).toBeNull();
    fireEvent.change(picker, { target: { value: 'g2' } });
    expect(treeItem('servidor')).toBeTruthy();
    expect(within(screen.getByRole('tree')).queryByRole('treeitem', { name: 'dev' })).toBeNull();
  });
});
