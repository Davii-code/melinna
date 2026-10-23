import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { PromptLibrary } from '../../../src/renderer/components/Prompts/PromptLibrary';
import type { Group, Prompt } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, prompt } from '../../support/fake-api';

const groups: Group[] = [
  { id: 'w1', name: 'site', order: 0, repoPath: '/repos/site' },
  { id: 'w2', name: 'api', order: 1, repoPath: '/repos/api' },
];

const revisar = prompt({ id: 'p1', name: 'Revisar', body: 'Revise {{arquivo}} e aponte riscos' });
const testes = prompt({ id: 'p2', name: 'Escrever testes', body: 'Escreva testes para {{pasta}}', scope: { groupId: 'w1' } });

function setup(list: Prompt[] = [revisar, testes], groupId: string | null = 'w1') {
  const api = fakeApi();
  api.prompts.list.mockImplementation(() => okR(list));
  const onUse = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <PromptLibrary groupId={groupId} groups={groups} onUse={onUse} onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onUse, onClose };
}

const dialog = () => screen.getByRole('dialog', { name: 'Biblioteca de prompts' });

describe('PromptLibrary', () => {
  it('lists the prompts of the workspace in context and shows their scope and variables', async () => {
    const { api } = setup();
    expect(await screen.findByText('Revisar')).toBeTruthy();
    expect(screen.getByText('Escrever testes')).toBeTruthy();
    expect(api.prompts.list).toHaveBeenCalledWith('w1');
    expect(dialog().textContent).toMatch(/global/);
    expect(dialog().textContent).toMatch(/site/);
    expect(dialog().textContent).toMatch(/\{\{arquivo\}\}/);
  });

  it('lists only the global prompts when no workspace is in context', async () => {
    const { api } = setup([revisar], null);
    await screen.findByText('Revisar');
    expect(api.prompts.list).toHaveBeenCalledWith(undefined);
  });

  it('shows an empty state', async () => {
    setup([]);
    expect(await screen.findByText(/Nenhum prompt ainda/)).toBeTruthy();
  });

  it('filters by name or text with the search box', async () => {
    setup();
    await screen.findByText('Revisar');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar prompts' }), { target: { value: 'riscos' } });
    expect(screen.getByText('Revisar')).toBeTruthy();
    expect(screen.queryByText('Escrever testes')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar prompts' }), { target: { value: 'ESCREVER' } });
    expect(screen.queryByText('Revisar')).toBeNull();
    expect(screen.getByText('Escrever testes')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar prompts' }), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nenhum prompt encontrado/)).toBeTruthy();
  });

  it('creates a global prompt and shows the detected variables while typing', async () => {
    const { api } = setup([]);
    await screen.findByText(/Nenhum prompt ainda/);
    fireEvent.click(screen.getByRole('button', { name: 'Novo prompt' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Revisar' } });
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'Revise {{arquivo}} e {{arquivo}} {{a-b}}' } });
    expect(screen.getByText('Variáveis: {{arquivo}}')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.prompts.save).toHaveBeenCalledWith({
        name: 'Revisar',
        body: 'Revise {{arquivo}} e {{arquivo}} {{a-b}}',
        scope: 'global',
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText('Nome')).toBeNull());
  });

  it('saves with the scope of a workspace', async () => {
    const { api } = setup([]);
    await screen.findByText(/Nenhum prompt ainda/);
    fireEvent.click(screen.getByRole('button', { name: 'Novo prompt' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Do site' } });
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Escopo'), { target: { value: 'w2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.prompts.save).toHaveBeenCalledWith({ name: 'Do site', body: 'x', scope: { groupId: 'w2' } }),
    );
  });

  it('keeps Save disabled until there is a name and a text', async () => {
    setup([]);
    await screen.findByText(/Nenhum prompt ainda/);
    fireEvent.click(screen.getByRole('button', { name: 'Novo prompt' }));
    const save = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'A' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'b' } });
    expect(save.disabled).toBe(false);
  });

  it('edits an existing prompt keeping its id', async () => {
    const { api } = setup();
    await screen.findByText('Revisar');
    const row = screen.getByText('Revisar').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Editar' }));
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Revisar');
    expect((screen.getByLabelText('Texto') as HTMLTextAreaElement).value).toBe(revisar.body);
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Revisar PR' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(api.prompts.save).toHaveBeenCalledWith({
        id: 'p1',
        name: 'Revisar PR',
        body: revisar.body,
        scope: 'global',
      }),
    );
  });

  it('shows the error from the main process and keeps the form open', async () => {
    const { api } = setup([]);
    api.prompts.save.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'O prompt contém caracteres de controle; remova-os.' },
      }),
    );
    await screen.findByText(/Nenhum prompt ainda/);
    fireEvent.click(screen.getByRole('button', { name: 'Novo prompt' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O prompt contém caracteres de controle; remova-os.');
    expect(screen.getByLabelText('Nome')).toBeTruthy();
  });

  it('cancels the form without saving', async () => {
    const { api } = setup([]);
    await screen.findByText(/Nenhum prompt ainda/);
    fireEvent.click(screen.getByRole('button', { name: 'Novo prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Nome')).toBeNull();
    expect(api.prompts.save).not.toHaveBeenCalled();
  });

  it('duplicates a prompt', async () => {
    const { api } = setup();
    await screen.findByText('Revisar');
    const row = screen.getByText('Revisar').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Duplicar' }));
    await waitFor(() => expect(api.prompts.duplicate).toHaveBeenCalledWith('p1'));
  });

  it('asks before deleting and deletes only on confirmation', async () => {
    const { api } = setup();
    await screen.findByText('Revisar');
    const row = screen.getByText('Revisar').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Excluir' }));
    expect(screen.getByText('Excluir o prompt "Revisar"?')).toBeTruthy();
    expect(api.prompts.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Não excluir' }));
    expect(api.prompts.remove).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Excluir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Excluir prompt' }));
    await waitFor(() => expect(api.prompts.remove).toHaveBeenCalledWith('p1'));
  });

  it('reloads the list when the library changes', async () => {
    const { api } = setup();
    await screen.findByText('Revisar');
    expect(api.prompts.list).toHaveBeenCalledTimes(1);
    api.prompts.list.mockImplementation(() => okR([prompt({ id: 'p9', name: 'Novo de fora' })]));
    api.emitPromptsChange();
    expect(await screen.findByText('Novo de fora')).toBeTruthy();
    expect(screen.queryByText('Revisar')).toBeNull();
  });

  it('uses a prompt: hands it to the caller', async () => {
    const { onUse } = setup();
    await screen.findByText('Revisar');
    const row = screen.getByText('Revisar').closest('li') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Usar' }));
    expect(onUse).toHaveBeenCalledWith(revisar);
  });

  it('offers to send a free text', async () => {
    const { onUse } = setup();
    await screen.findByText('Revisar');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar texto avulso' }));
    expect(onUse).toHaveBeenCalledWith(null);
  });

  it('closes with Esc and with the close button', async () => {
    const { onClose } = setup();
    await screen.findByText('Revisar');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
