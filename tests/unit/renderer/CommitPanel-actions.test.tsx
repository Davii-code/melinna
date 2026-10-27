import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitPanel } from '../../../src/renderer/components/Git/CommitPanel';
import type { NeedsConfirm } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { change, renderWithGit } from '../../support/git-render';

const statuses = {
  '/a': { branch: 'main', changes: [change('src/x.ts'), change('n.txt', 'untracked')] },
  '/b': { branch: 'dev', changes: [change('z.ts', 'added')] },
};

function setup(
  over: {
    liveAgents?: number;
    roots?: string[];
    statuses?: Record<string, never> | typeof statuses;
    workspace?: null;
  } = {},
) {
  const onShowDiff = vi.fn();
  const onOpenFile = vi.fn();
  const api = fakeApi();
  const utils = renderWithGit(
    <CommitPanel liveAgents={over.liveAgents ?? 0} onOpenFile={onOpenFile} onShowDiff={onShowDiff} />,
    {
      api,
      roots: over.roots ?? ['/a', '/b'],
      statuses: (over.statuses ?? statuses) as never,
      ...(over.workspace === null ? { workspace: null } : {}),
    },
  );
  return { onShowDiff, onOpenFile, ...utils };
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('CommitPanel actions', () => {
  it('Atualizar rereads every repository', async () => {
    const { api } = setup();
    await screen.findByText('src');
    const before = api.git.status.mock.calls.length;
    fireEvent.click(button('Atualizar'));
    await waitFor(() => expect(api.git.status.mock.calls.length).toBe(before + 2));
  });

  it('Expandir tudo and Recolher tudo', async () => {
    setup();
    await screen.findByText('x.ts');
    fireEvent.click(button('Recolher tudo'));
    expect(screen.queryByText('x.ts')).toBeNull();
    expect(screen.queryByText('Changes')).not.toBeNull();
    fireEvent.click(button('Expandir tudo'));
    expect(screen.getByText('x.ts')).toBeTruthy();
    expect(screen.getByText('z.ts')).toBeTruthy();
  });

  it('Ver diff shows the focused file, and is disabled when there is nothing to show', async () => {
    const { onShowDiff } = setup();
    await screen.findByText('x.ts');
    fireEvent.click(screen.getByText('z.ts'));
    expect(onShowDiff).toHaveBeenLastCalledWith('/b', 'z.ts');
    fireEvent.click(button('Ver diff'));
    expect(onShowDiff).toHaveBeenCalledTimes(2);
    expect(onShowDiff).toHaveBeenLastCalledWith('/b', 'z.ts');
  });

  it('Reverter asks for confirmation per file, including "apagar" for unversioned ones', async () => {
    const { api } = setup({ roots: ['/a'], statuses: { '/a': statuses['/a'] } as never });
    await screen.findByText('x.ts');
    fireEvent.click(screen.getByLabelText('Selecionar n.txt'));
    const request: NeedsConfirm = {
      needsConfirm: 'discard',
      details: {
        files: [
          { path: 'src/x.ts', action: 'reverter' },
          { path: 'n.txt', action: 'apagar' },
        ],
      },
    };
    api.git.discard.mockImplementationOnce(() => okR<never>(request as never));
    fireEvent.click(button('Reverter'));
    const list = await screen.findByTestId('git-confirm-files');
    expect(within(list).getByText('n.txt')).toBeTruthy();
    expect(within(list).getByText(/apagar o arquivo/)).toBeTruthy();
    expect(within(list).getByText(/reverter ao último commit/)).toBeTruthy();
    expect(api.git.discard).toHaveBeenCalledWith('/a', ['src/x.ts', 'n.txt']);
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(api.git.discard).toHaveBeenCalledTimes(2));
    expect(api.git.discard).toHaveBeenLastCalledWith('/a', ['src/x.ts', 'n.txt'], ['discard']);
  });

  it('refusing the confirmation changes nothing', async () => {
    const { api } = setup({ roots: ['/a'], statuses: { '/a': statuses['/a'] } as never });
    await screen.findByText('x.ts');
    api.git.discard.mockImplementationOnce(() =>
      okR<never>({
        needsConfirm: 'discard',
        details: { files: [{ path: 'src/x.ts', action: 'reverter' }] },
      } as never),
    );
    fireEvent.click(button('Reverter'));
    await screen.findByTestId('git-confirm-files');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(api.git.discard).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('git-confirm-files')).toBeNull();
  });

  it('Reverter is disabled with nothing marked', async () => {
    setup({ roots: ['/a'], statuses: { '/a': { changes: [change('n.txt', 'untracked')] } } as never });
    await screen.findByText('n.txt');
    expect(button('Reverter').disabled).toBe(true);
  });

  it('warns that live agents may be writing', async () => {
    setup({ liveAgents: 2 });
    expect((await screen.findByRole('status')).textContent).toMatch(/2 agentes rodando/);
  });

  it('has no warning without agents', async () => {
    setup({ liveAgents: 0 });
    await screen.findByText('x.ts');
    expect(screen.queryByText(/agentes? rodando/)).toBeNull();
  });

  it('empty states', async () => {
    const none = setup({ workspace: null });
    expect(await screen.findByText('Abra um workspace')).toBeTruthy();
    none.unmount();
    const clean = setup({ roots: ['/a'], statuses: { '/a': { changes: [] } } as never });
    expect(await screen.findByText('Nenhuma alteração')).toBeTruthy();
    clean.unmount();
  });

  it('says when no folder is a git repository', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() =>
      Promise.resolve({ ok: false as const, error: { code: 'REPO_INVALID' as const, message: 'não é git' } }),
    );
    const onShowDiff = vi.fn();
    renderWithGit(<CommitPanel liveAgents={0} onOpenFile={vi.fn()} onShowDiff={onShowDiff} />, {
      api,
      roots: ['/a'],
    });
    expect(await screen.findByText('Nenhum repositório git neste workspace')).toBeTruthy();
  });

  it('rereads on window focus keeping the marks', async () => {
    const { api } = setup({ roots: ['/a'], statuses: { '/a': statuses['/a'] } as never });
    await screen.findByText('x.ts');
    fireEvent.click(screen.getByLabelText('Selecionar x.ts'));
    const before = api.git.status.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.git.status.mock.calls.length).toBe(before + 1));
    await waitFor(() =>
      expect((screen.getByLabelText('Selecionar x.ts') as HTMLInputElement).checked).toBe(false),
    );
  });

  describe('Adicionar ao git', () => {
    const one = { '/a': statuses['/a'] } as never;
    const levelOf = (name: string) =>
      screen.getByLabelText(`Selecionar ${name}`).closest('[role="treeitem"]')?.getAttribute('aria-level');

    it('is disabled until an unversioned file is marked', async () => {
      setup({ roots: ['/a'], statuses: one });
      await screen.findByText('n.txt');
      expect(button('Adicionar ao git').disabled).toBe(true);
      fireEvent.click(screen.getByLabelText('Selecionar n.txt'));
      expect(button('Adicionar ao git').disabled).toBe(false);
    });

    it('moves the marked unversioned files to Changes, keeping them marked, without calling git', async () => {
      const { api } = setup({ roots: ['/a'], statuses: one });
      await screen.findByText('n.txt');
      expect(screen.getByText('Unversioned Files')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Selecionar n.txt'));
      fireEvent.click(button('Adicionar ao git'));
      expect(screen.queryByText('Unversioned Files')).toBeNull();
      expect((screen.getByLabelText('Selecionar n.txt') as HTMLInputElement).checked).toBe(true);
      expect(levelOf('n.txt')).toBe('3');
      expect(api.git.commit).not.toHaveBeenCalled();
      expect(api.git.discard).not.toHaveBeenCalled();
    });

    it('Ctrl+Alt+A on a row adds the unversioned files under it', async () => {
      setup({ roots: ['/a'], statuses: one });
      await screen.findByText('n.txt');
      const group = screen.getByRole('treeitem', { name: /Unversioned Files/ });
      fireEvent.keyDown(group, { key: 'a', ctrlKey: true, altKey: true });
      expect(screen.queryByText('Unversioned Files')).toBeNull();
      expect((screen.getByLabelText('Selecionar n.txt') as HTMLInputElement).checked).toBe(true);
    });

    it('keeps the file in Changes after rereading while it is still unversioned', async () => {
      setup({ roots: ['/a'], statuses: one });
      await screen.findByText('n.txt');
      fireEvent.click(screen.getByLabelText('Selecionar n.txt'));
      fireEvent.click(button('Adicionar ao git'));
      fireEvent.click(button('Atualizar'));
      await act(async () => undefined);
      expect(screen.queryByText('Unversioned Files')).toBeNull();
    });
  });
});
