import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { FileExplorer } from '../../../src/renderer/components/Files/FileExplorer';
import type { DirectoryListing, FileRoot } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const ROOT: FileRoot = { path: '/ws', label: 'site', kind: 'workspace' };

function listing(path: string, entries: DirectoryListing['entries']): DirectoryListing {
  return { path, entries, truncated: false };
}

const TREE: Record<string, DirectoryListing> = {
  '/ws': listing('/ws', [
    { name: 'src', path: '/ws/src', kind: 'directory', size: 0 },
    { name: 'a.txt', path: '/ws/a.txt', kind: 'file', size: 12 },
  ]),
  '/ws/src': listing('/ws/src', [{ name: 'main.ts', path: '/ws/src/main.ts', kind: 'file', size: 1200 }]),
};

function setup(roots: FileRoot[] = [ROOT]) {
  const api = fakeApi();
  const onOpenFile = vi.fn();
  api.files.roots.mockImplementation(() => okR(roots));
  api.files.list.mockImplementation((p: string) => okR(TREE[p] ?? listing(p, [])));
  api.files.status.mockImplementation(() => okR({}));
  const view = render(
    <ApiContext.Provider value={api}>
      <FileExplorer onOpenFile={onOpenFile} />
    </ApiContext.Provider>,
  );
  return { api, view, onOpenFile };
}

describe('FileExplorer', () => {
  it('explains how to open a folder when there is no root', async () => {
    setup([]);
    expect(
      await screen.findByText(/Abra uma pasta como workspace para navegar/),
    ).toBeTruthy();
  });

  it('lists the root and expands a folder on demand', async () => {
    const { api } = setup();
    expect(await screen.findByText('a.txt')).toBeTruthy();
    expect(api.files.list.mock.calls[0]?.[0]).toBe('/ws');
    expect(await screen.findByText('src')).toBeTruthy();
    expect(screen.queryByText('main.ts')).toBeNull();
    fireEvent.click(screen.getByTestId('dir-src'));
    expect(await screen.findByText('main.ts')).toBeTruthy();
    expect(api.files.list.mock.calls.map((c) => c[0])).toContain('/ws/src');
  });

  it('opens a file in the editor with a single click, without a preview window', async () => {
    const { api, onOpenFile } = setup();
    fireEvent.click(await screen.findByTestId('file-a.txt'));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile).toHaveBeenCalledWith('/ws/a.txt');
    expect(api.files.read).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a folder in the tree, not in the editor', async () => {
    const { onOpenFile } = setup();
    fireEvent.click(await screen.findByTestId('dir-src'));
    expect(await screen.findByText('main.ts')).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it('shows the git status of a file and of a folder that contains changes', async () => {
    const { api } = setup();
    api.files.status.mockImplementation(() => okR({ 'a.txt': 'modified', 'src/main.ts': 'added' }));
    expect(await screen.findByText('a.txt')).toBeTruthy();
    // o arquivo modificado ganha a marca
    expect(await screen.findByLabelText('modificado')).toBeTruthy();
    // a pasta que contém um arquivo adicionado também é sinalizada
    expect(await screen.findByLabelText('adicionado')).toBeTruthy();
  });

  it('shows the error message when a folder cannot be read', async () => {
    const { api } = setup();
    api.files.list.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'FILE_OUTSIDE_ROOT' as const, message: 'Este caminho está fora das pastas abertas no app.' },
      }),
    );
    expect(await screen.findByText(/fora das pastas abertas/)).toBeTruthy();
  });
});

describe('FileExplorer — workspace com várias pastas', () => {
  const PRIMARY: FileRoot = {
    path: '/ws',
    label: 'Plataforma · site',
    kind: 'workspace',
    workspaceId: 'w1',
    primary: true,
  };
  const OTHER: FileRoot = { path: '/api', label: 'Plataforma · api', kind: 'workspace', workspaceId: 'w1' };
  const GONE: FileRoot = {
    path: '/sumiu',
    label: 'Plataforma · sumiu',
    kind: 'workspace',
    workspaceId: 'w1',
    available: false,
  };

  it('marks the primary folder in the selector and beside the path', async () => {
    setup([PRIMARY, OTHER]);
    expect(await screen.findByRole('option', { name: '★ Plataforma · site' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Plataforma · api' })).toBeTruthy();
    expect(screen.getByText('principal')).toBeTruthy();
  });

  it('does not mark anything in a workspace of one folder', async () => {
    setup();
    expect(await screen.findByText('a.txt')).toBeTruthy();
    expect(screen.queryByText('principal')).toBeNull();
    expect(screen.queryByRole('option', { name: /★/ })).toBeNull();
  });

  it('shows an unavailable root disabled and never opens it', async () => {
    const { api } = setup([GONE, PRIMARY, OTHER]);
    const option = (await screen.findByRole('option', { name: 'Plataforma · sumiu (indisponível)' })) as HTMLOptionElement;
    expect(option.disabled).toBe(true);
    await screen.findByText('a.txt');
    expect(api.files.list.mock.calls.map((c) => c[0])).not.toContain('/sumiu');
    expect((screen.getByLabelText('Raiz do explorador') as HTMLSelectElement).value).toBe('/ws');
  });

  it('switches to another folder of the workspace and lists it', async () => {
    const { api } = setup([PRIMARY, OTHER]);
    await screen.findByText('a.txt');
    fireEvent.change(screen.getByLabelText('Raiz do explorador'), { target: { value: '/api' } });
    await waitFor(() => expect(api.files.list.mock.calls.map((c) => c[0])).toContain('/api'));
    expect(api.files.status).toHaveBeenCalledWith('/api');
  });

  it('shows a root outside git without badges and without an error', async () => {
    const { api } = setup([PRIMARY, OTHER]);
    api.files.status.mockImplementation(() => okR({}));
    await screen.findByText('a.txt');
    fireEvent.change(screen.getByLabelText('Raiz do explorador'), { target: { value: '/api' } });
    await waitFor(() => expect(api.files.status).toHaveBeenCalledWith('/api'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.querySelector('.files-status')).toBeNull();
    expect(document.querySelector('.files-message.error')).toBeNull();
  });

  it('opens nothing when every root is unavailable', async () => {
    const { api } = setup([GONE]);
    await waitFor(() => expect(api.files.roots).toHaveBeenCalled());
    expect(api.files.list).not.toHaveBeenCalled();
    expect(await screen.findByText(/Abra uma pasta como workspace/)).toBeTruthy();
  });
});

