import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { FileExplorer } from '../../../src/renderer/components/Files/FileExplorer';
import type { DirectoryListing, FileRoot, FileText } from '../../../src/shared/ipc-contract';
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

const FILE: FileText = {
  path: '/ws/a.txt',
  content: 'olá mundo',
  size: 12,
  binary: false,
  truncated: false,
  hash: 'a'.repeat(64),
};

function setup(roots: FileRoot[] = [ROOT]) {
  const api = fakeApi();
  api.files.roots.mockImplementation(() => okR(roots));
  api.files.list.mockImplementation((p: string) => okR(TREE[p] ?? listing(p, [])));
  api.files.read.mockImplementation(() => okR(FILE));
  const view = render(
    <ApiContext.Provider value={api}>
      <FileExplorer />
    </ApiContext.Provider>,
  );
  return { api, view };
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

  it('opens a read-only preview of a file', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByTestId('file-a.txt'));
    expect(await screen.findByText('olá mundo')).toBeTruthy();
    expect(api.files.read.mock.calls[0]?.[0]).toBe('/ws/a.txt');
    fireEvent.click(screen.getByText('Fechar'));
    await waitFor(() => expect(screen.queryByText('olá mundo')).toBeNull());
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
