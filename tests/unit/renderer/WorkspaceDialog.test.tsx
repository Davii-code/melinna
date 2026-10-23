import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { WorkspaceDialog, type WorkspaceDialogProps } from '../../../src/renderer/components/WorkspaceDialog';
import type { Group } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

function setup(props: Partial<WorkspaceDialogProps> = {}) {
  const api = fakeApi();
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <WorkspaceDialog onDone={onDone} onClose={onClose} {...props} />
    </ApiContext.Provider>,
  );
  return { api, onDone, onClose };
}

const addButton = () => screen.getByRole('button', { name: /Adicionar pastas/ });
const createButton = () => screen.getByRole('button', { name: 'Criar workspace' });
const nameInput = () => screen.getByRole('textbox', { name: 'Nome' });

async function pick(api: ReturnType<typeof fakeApi>, paths: string[]) {
  api.workspace.pickFolders.mockImplementationOnce(() => okR(paths));
  fireEvent.click(addButton());
  await screen.findByText(paths[0] ?? '');
}

describe('WorkspaceDialog — criar', () => {
  it('blocks creating without a name or without folders', async () => {
    const { api } = setup();
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(nameInput(), { target: { value: 'Plataforma' } });
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
    await pick(api, ['/repos/site']);
    expect((createButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('adds several folders from one pick, in order, with the first as primary', async () => {
    const { api } = setup();
    await pick(api, ['/repos/site', '/repos/api', '/repos/web']);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Principal: /repos/site',
      'Principal: /repos/api',
      'Principal: /repos/web',
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false]);
  });

  it('opens the native dialog on the last folder chosen', async () => {
    const { api } = setup();
    await pick(api, ['/repos/site']);
    api.workspace.pickFolders.mockImplementationOnce(() => okR(['/repos/api']));
    fireEvent.click(addButton());
    await screen.findByText('/repos/api');
    expect(api.workspace.pickFolders).toHaveBeenNthCalledWith(1, undefined);
    expect(api.workspace.pickFolders).toHaveBeenNthCalledWith(2, '/repos/site');
  });

  it('adds nothing when the dialog is cancelled', async () => {
    const { api } = setup();
    api.workspace.pickFolders.mockImplementationOnce(() => okR<string[]>([]));
    fireEvent.click(addButton());
    await waitFor(() => expect(api.workspace.pickFolders).toHaveBeenCalled());
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a message and adds nothing for a repeated folder', async () => {
    const { api } = setup();
    await pick(api, ['/repos/site']);
    api.workspace.pickFolders.mockImplementationOnce(() => okR(['/repos/api', '/repos/site/']));
    fireEvent.click(addButton());
    expect((await screen.findByRole('alert')).textContent).toBe('A pasta /repos/site/ já está neste workspace.');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });

  it('treats Windows paths as the same folder regardless of case', async () => {
    const { api } = setup();
    await pick(api, ['C:\\Work\\App']);
    api.workspace.pickFolders.mockImplementationOnce(() => okR(['c:\\work\\app']));
    fireEvent.click(addButton());
    expect((await screen.findByRole('alert')).textContent).toMatch(/já está neste workspace/);
  });

  it('blocks going over 32 folders', async () => {
    const { api } = setup();
    const first = Array.from({ length: 32 }, (_, i) => `/p${i}`);
    await pick(api, first);
    api.workspace.pickFolders.mockImplementationOnce(() => okR(['/uma-a-mais']));
    fireEvent.click(addButton());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Um workspace pode ter no máximo 32 pastas.',
    );
    expect(screen.getAllByRole('radio')).toHaveLength(32);
    expect(screen.queryByText('/uma-a-mais')).toBeNull();
  });

  it('lets the user remove a folder and keeps the primary on the right one', async () => {
    const { api } = setup();
    await pick(api, ['/a', '/b', '/c']);
    fireEvent.click(screen.getByRole('radio', { name: 'Principal: /c' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta /a' }));
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => [r.getAttribute('aria-label'), r.checked])).toEqual([
      ['Principal: /b', false],
      ['Principal: /c', true],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta /c' }));
    expect((screen.getByRole('radio', { name: 'Principal: /b' }) as HTMLInputElement).checked).toBe(true);
  });

  it('sends createWorkspace with the trimmed name, the folders and the chosen primary index', async () => {
    const { api, onDone } = setup();
    fireEvent.change(nameInput(), { target: { value: '  Plataforma  ' } });
    await pick(api, ['/repos/site', '/repos/api']);
    fireEvent.click(screen.getByRole('radio', { name: 'Principal: /repos/api' }));
    fireEvent.click(createButton());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.workspace.createWorkspace).toHaveBeenCalledWith({
      name: 'Plataforma',
      folders: ['/repos/site', '/repos/api'],
      primaryIndex: 1,
    });
    expect(onDone.mock.calls[0]?.[0]).toMatchObject({ name: 'Plataforma' });
  });

  it('shows the error from the main process and keeps the dialog open', async () => {
    const { api, onDone } = setup();
    api.workspace.createWorkspace.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'A pasta /repos/site não existe.' },
      }),
    );
    fireEvent.change(nameInput(), { target: { value: 'X' } });
    await pick(api, ['/repos/site']);
    fireEvent.click(createButton());
    expect((await screen.findByRole('alert')).textContent).toBe('A pasta /repos/site não existe.');
    expect(onDone).not.toHaveBeenCalled();
    expect((createButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes with Esc and with Cancelar', () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

const workspace: Group = {
  id: 'w1',
  name: 'Plataforma',
  order: 0,
  folders: [
    { id: 'f1', path: '/repos/site' },
    { id: 'f2', path: '/repos/api' },
  ],
  primaryFolderId: 'f1',
  repoPath: '/repos/site',
};

describe('WorkspaceDialog — editar', () => {
  it('lists the folders with the primary marked', () => {
    setup({ group: workspace });
    expect(screen.getByRole('dialog', { name: 'Editar workspace' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Principal: /repos/site' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Principal: /repos/api' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByText('principal')).toHaveLength(1);
  });

  it('renames on blur with the rename kind, and ignores an unchanged or empty name', async () => {
    const { api } = setup({ group: workspace });
    fireEvent.change(nameInput(), { target: { value: 'Outro nome' } });
    fireEvent.blur(nameInput());
    await waitFor(() =>
      expect(api.workspace.updateWorkspace).toHaveBeenCalledWith('w1', { kind: 'rename', name: 'Outro nome' }),
    );
    api.workspace.updateWorkspace.mockClear();
    fireEvent.change(nameInput(), { target: { value: 'Plataforma' } });
    fireEvent.blur(nameInput());
    fireEvent.change(nameInput(), { target: { value: '  ' } });
    fireEvent.blur(nameInput());
    expect(api.workspace.updateWorkspace).not.toHaveBeenCalled();
    expect((nameInput() as HTMLInputElement).value).toBe('Plataforma');
  });

  it('adds the picked folders with addFolders', async () => {
    const { api } = setup({ group: workspace });
    api.workspace.pickFolders.mockImplementationOnce(() => okR(['/repos/web', '/repos/docs']));
    fireEvent.click(addButton());
    await waitFor(() =>
      expect(api.workspace.updateWorkspace).toHaveBeenCalledWith('w1', {
        kind: 'addFolders',
        folders: ['/repos/web', '/repos/docs'],
      }),
    );
    expect(api.workspace.pickFolders).toHaveBeenCalledWith('/repos/api');
  });

  it('refuses in the interface a folder that is already in the workspace', async () => {
    const { api } = setup({ group: workspace });
    api.workspace.pickFolders.mockImplementationOnce(() => okR(['/repos/api']));
    fireEvent.click(addButton());
    expect((await screen.findByRole('alert')).textContent).toBe('A pasta /repos/api já está neste workspace.');
    expect(api.workspace.updateWorkspace).not.toHaveBeenCalled();
  });

  it('removes a folder with removeFolder', async () => {
    const { api } = setup({ group: workspace });
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta /repos/api' }));
    await waitFor(() =>
      expect(api.workspace.updateWorkspace).toHaveBeenCalledWith('w1', { kind: 'removeFolder', folderId: 'f2' }),
    );
  });

  it('changes the primary with setPrimary', async () => {
    const { api } = setup({ group: workspace });
    fireEvent.click(screen.getByRole('radio', { name: 'Principal: /repos/api' }));
    await waitFor(() =>
      expect(api.workspace.updateWorkspace).toHaveBeenCalledWith('w1', { kind: 'setPrimary', folderId: 'f2' }),
    );
  });

  it('disables removing the only folder', () => {
    const single: Group = { ...workspace, folders: [{ id: 'f1', path: '/repos/site' }] };
    setup({ group: single });
    expect((screen.getByRole('button', { name: 'Remover pasta /repos/site' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the "new terminals only" notice only when the workspace has a live session', () => {
    setup({ group: workspace, hasLiveSession: true });
    expect(screen.getByRole('status').textContent).toMatch(/terminais novos/);
    cleanup();
    setup({ group: workspace, hasLiveSession: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('marks an unavailable folder', () => {
    setup({ group: workspace, availability: { f1: true, f2: false } });
    const row = screen.getByText('/repos/api').closest('li');
    expect(row?.textContent).toMatch(/indisponível/);
    expect(screen.getByText('/repos/site').closest('li')?.textContent).not.toMatch(/indisponível/);
  });

  it('shows the error from the main process', async () => {
    const { api } = setup({ group: workspace });
    api.workspace.updateWorkspace.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'Um workspace precisa de ao menos uma pasta.' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover pasta /repos/api' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Um workspace precisa de ao menos uma pasta.');
  });

  it('closes with Fechar', () => {
    const { onClose } = setup({ group: workspace });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
