import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { HistoryView } from '../../../src/renderer/components/Git/HistoryView';
import type { Commit } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

function commit(n: number, over: Partial<Commit> = {}): Commit {
  const sha = n.toString(16).padStart(40, '0');
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author: `Autor ${n}`,
    email: `autor${n}@example.com`,
    date: '2026-10-22T14:30:00-03:00',
    subject: `Mensagem ${n}`,
    body: '',
    files: [{ path: `src/f${n}.ts`, kind: 'modified' }],
    ...over,
  };
}

function setup(pages: Commit[][] = [[commit(1), commit(2), commit(3)]]) {
  const api = fakeApi();
  let call = 0;
  api.git.log.mockImplementation(() => okR(pages[Math.min(call++, pages.length - 1)] ?? []));
  const onClose = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <HistoryView repo="/repo" title="site" onClose={onClose} />
    </ApiContext.Provider>,
  );
  return { api, onClose };
}

describe('HistoryView', () => {
  it('lists commits with author, date and message', async () => {
    const { api } = setup();
    expect(await screen.findByText('Mensagem 1')).toBeTruthy();
    expect(screen.getByText('Mensagem 3')).toBeTruthy();
    expect(screen.getByText(/Autor 2/)).toBeTruthy();
    expect(screen.getAllByText(/22\/10\/2026/).length).toBe(3);
    expect(api.git.log).toHaveBeenCalledWith('/repo', 0);
  });

  it('loads more only when a full page came back', async () => {
    const full = Array.from({ length: 200 }, (_, i) => commit(i + 1));
    const { api } = setup([full, [commit(201), commit(202)]]);
    await screen.findByText('Mensagem 1');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(api.git.log).toHaveBeenLastCalledWith('/repo', 200));
    expect(await screen.findByText('Mensagem 202')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('does not offer to load more for a short page', async () => {
    setup();
    await screen.findByText('Mensagem 1');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('shows the files of a commit and the diff of one of them', async () => {
    const { api } = setup([[commit(1, { body: 'Detalhes do commit', files: [{ path: 'src/a.ts', kind: 'modified' }, { path: 'novo.txt', kind: 'added' }] })]]);
    api.git.commitDiff.mockImplementation((_repo: string, _sha: string, path: string) =>
      okR({
        path,
        change: 'modified' as const,
        hunks: [
          {
            header: '@@ -1 +1 @@',
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { kind: 'del' as const, text: 'antes', oldNo: 1, newNo: null },
              { kind: 'add' as const, text: 'depois', oldNo: null, newNo: 1 },
            ],
          },
        ],
        lineCount: 2,
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: /Mensagem 1/ }));
    expect(await screen.findByText('Detalhes do commit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver diff de src/a.ts' }));
    expect(await screen.findByText('depois')).toBeTruthy();
    expect(api.git.commitDiff).toHaveBeenCalledWith('/repo', commit(1).sha, 'src/a.ts');
  });

  it('shows an empty state and an error', async () => {
    setup([[]]);
    expect(await screen.findByText(/Nenhum commit/)).toBeTruthy();
  });

  it('shows the error when the log cannot be read', async () => {
    const api = fakeApi();
    api.git.log.mockImplementation(() =>
      Promise.resolve({ ok: false as const, error: { code: 'GIT_FAILED' as const, message: 'fatal: falhou' } }),
    );
    render(
      <ApiContext.Provider value={api}>
        <HistoryView repo="/repo" title="site" onClose={vi.fn()} />
      </ApiContext.Provider>,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/falhou/);
  });

  it('closes', async () => {
    const { onClose } = setup();
    await screen.findByText('Mensagem 1');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar histórico' }));
    expect(onClose).toHaveBeenCalled();
  });
});
