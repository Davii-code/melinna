import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { CommitDialog } from '../../../src/renderer/components/Git/CommitDialog';
import type { Change, FileDiff } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from '../../support/fake-api';

const CHANGES: Change[] = [
  { path: 'README.md', kind: 'modified', indexChanged: false, worktreeChanged: true },
  { path: 'src/a.ts', kind: 'modified', indexChanged: false, worktreeChanged: true },
  { path: 'src/b.ts', kind: 'untracked', indexChanged: false, worktreeChanged: true },
  { path: 'docs/guia/x.md', kind: 'added', indexChanged: true, worktreeChanged: false },
];

function diffOf(path: string, extra: Partial<FileDiff> = {}): FileDiff {
  return {
    path,
    change: 'modified',
    hunks: [
      {
        header: '@@ -1 +1 @@',
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: 'del', text: 'antes', oldNo: 1, newNo: null },
          { kind: 'add', text: 'depois', oldNo: null, newNo: 1 },
        ],
      },
    ],
    lineCount: 2,
    ...extra,
  };
}

function setup(over: { changes?: Change[]; liveAgents?: number; mergeMessage?: string | null; state?: 'normal' | 'merging' } = {}) {
  const api = fakeApi();
  api.git.status.mockImplementation(() =>
    okR(
      repoStatus({
        root: '/repo',
        changes: over.changes ?? CHANGES,
        state: over.state ?? 'normal',
        mergeMessage: over.mergeMessage ?? null,
      }),
    ),
  );
  const onClose = vi.fn();
  const onPushStarted = vi.fn();
  render(
    <ApiContext.Provider value={api}>
      <CommitDialog
        repo="/repo"
        title="site"
        liveAgents={over.liveAgents ?? 0}
        onClose={onClose}
        onPushStarted={onPushStarted}
      />
    </ApiContext.Provider>,
  );
  return { api, onClose, onPushStarted };
}

const commitButton = () => screen.getByRole('button', { name: 'Commit' });
const message = () => screen.getByLabelText('Mensagem do commit');
const fileBox = (path: string) => screen.getByLabelText(`Selecionar ${path}`) as HTMLInputElement;

async function ready() {
  await screen.findByLabelText('Selecionar README.md');
}

describe('CommitDialog', () => {
  it('lists the changes grouped by folder with everything selected', async () => {
    setup();
    await ready();
    for (const c of CHANGES) expect(fileBox(c.path).checked).toBe(true);
    expect(screen.getByLabelText('Selecionar pasta src')).toBeTruthy();
    expect(screen.getByLabelText('Selecionar pasta docs/guia')).toBeTruthy();
    expect(screen.getByLabelText('Selecionar pasta (raiz)')).toBeTruthy();
    expect(screen.getByText(/4 de 4 arquivos/)).toBeTruthy();
  });

  it('selects by file and by folder', async () => {
    setup();
    await ready();
    fireEvent.click(fileBox('src/a.ts'));
    expect(fileBox('src/a.ts').checked).toBe(false);
    expect((screen.getByLabelText('Selecionar pasta src') as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByLabelText('Selecionar pasta src'));
    expect(fileBox('src/a.ts').checked).toBe(true);
    expect(fileBox('src/b.ts').checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Selecionar pasta src'));
    expect(fileBox('src/a.ts').checked).toBe(false);
    expect(fileBox('src/b.ts').checked).toBe(false);
    expect(fileBox('README.md').checked).toBe(true);
    expect(screen.getByText(/2 de 4 arquivos/)).toBeTruthy();
  });

  it('shows the diff of a file when it is clicked, including binary and too-large cases', async () => {
    const { api } = setup();
    api.git.diffFile.mockImplementation((_repo: string, path: string) =>
      okR(
        path === 'src/b.ts'
          ? diffOf(path, { binary: { oldSize: 10, newSize: 20 }, hunks: [], lineCount: 0 })
          : path === 'docs/guia/x.md'
            ? diffOf(path, { tooLarge: true, hunks: [], lineCount: 0 })
            : diffOf(path),
      ),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Ver diff de src/a.ts' }));
    expect(await screen.findByText('depois')).toBeTruthy();
    expect(api.git.diffFile).toHaveBeenCalledWith('/repo', 'src/a.ts');
    fireEvent.click(screen.getByRole('button', { name: 'Ver diff de src/b.ts' }));
    expect(await screen.findByText(/Binário alterado/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver diff de docs/guia/x.md' }));
    expect(await screen.findByText(/grande demais para mostrar/)).toBeTruthy();
  });

  it('blocks the commit buttons without a selection or a message', async () => {
    setup();
    await ready();
    expect((commitButton() as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Commit e push' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(message(), { target: { value: 'uma mensagem' } });
    expect((commitButton() as HTMLButtonElement).disabled).toBe(false);
    for (const c of CHANGES) fireEvent.click(fileBox(c.path));
    expect((commitButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(fileBox('README.md'));
    fireEvent.change(message(), { target: { value: '   ' } });
    expect((commitButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('commits only the selected files with the message and closes', async () => {
    const { api, onClose } = setup();
    await ready();
    fireEvent.click(fileBox('src/b.ts'));
    fireEvent.change(message(), { target: { value: 'Ajusta a\n\ncorpo' } });
    fireEvent.click(commitButton());
    await waitFor(() => expect(api.git.commit).toHaveBeenCalled());
    expect(api.git.commit).toHaveBeenCalledWith('/repo', {
      paths: ['README.md', 'src/a.ts', 'docs/guia/x.md'],
      message: 'Ajusta a\n\ncorpo',
      amend: false,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.git.push).not.toHaveBeenCalled();
  });

  it('allows amending with no files selected and loads the last message', async () => {
    const { api } = setup();
    api.git.log.mockImplementation(() =>
      okR([
        {
          sha: 'a'.repeat(40),
          shortSha: 'aaaaaaa',
          author: 'Ana',
          email: 'a@b',
          date: '2026-10-23T10:00:00-03:00',
          subject: 'Último commit',
          body: 'com corpo',
          files: [],
        },
      ]),
    );
    await ready();
    for (const c of CHANGES) fireEvent.click(fileBox(c.path));
    fireEvent.click(screen.getByLabelText('Alterar o último commit (amend)'));
    await waitFor(() => expect((message() as HTMLTextAreaElement).value).toBe('Último commit\n\ncom corpo'));
    expect((commitButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(commitButton());
    await waitFor(() =>
      expect(api.git.commit).toHaveBeenCalledWith('/repo', {
        paths: [],
        message: 'Último commit\n\ncom corpo',
        amend: true,
      }),
    );
  });

  it('asks to confirm amending a published commit and repeats with the confirmation', async () => {
    const { api } = setup();
    api.git.commit.mockImplementationOnce(() =>
      okR({ needsConfirm: 'amend-published' as const, details: {} }),
    );
    await ready();
    fireEvent.change(message(), { target: { value: 'nova' } });
    fireEvent.click(screen.getByLabelText('Alterar o último commit (amend)'));
    fireEvent.click(commitButton());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/já está no remoto/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Alterar mesmo assim' }));
    await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(2));
    expect(api.git.commit.mock.calls[1]?.[1]).toMatchObject({ amend: true, confirm: ['amend-published'] });
  });

  it('discards a file only after confirming, listing the action per file', async () => {
    const { api } = setup();
    api.git.discard.mockImplementationOnce(() =>
      okR({
        needsConfirm: 'discard' as const,
        details: { files: [{ path: 'src/b.ts', action: 'apagar' as const }] },
      }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar src/b.ts' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('src/b.ts')).toBeTruthy();
    expect(within(dialog).getByText(/apagar o arquivo/)).toBeTruthy();
    expect(api.git.discard).toHaveBeenCalledWith('/repo', ['src/b.ts']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(api.git.discard).toHaveBeenCalledTimes(2));
    expect(api.git.discard).toHaveBeenLastCalledWith('/repo', ['src/b.ts'], ['discard']);
    await waitFor(() => expect(api.git.status.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps everything when the discard confirmation is cancelled', async () => {
    const { api } = setup();
    api.git.discard.mockImplementationOnce(() =>
      okR({ needsConfirm: 'discard' as const, details: { files: [{ path: 'README.md', action: 'reverter' as const }] } }),
    );
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar README.md' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/reverter ao último commit/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.git.discard).toHaveBeenCalledTimes(1);
  });

  it('warns when agents are running in the workspace', async () => {
    setup({ liveAgents: 2 });
    await ready();
    expect(screen.getByRole('status').textContent).toMatch(/2 agentes/);
  });

  it('shows no agent warning when none is running', async () => {
    setup({ liveAgents: 0 });
    await ready();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('commit and push calls commit and, on success, push', async () => {
    const { api, onPushStarted, onClose } = setup();
    await ready();
    fireEvent.change(message(), { target: { value: 'envia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit e push' }));
    await waitFor(() => expect(api.git.push).toHaveBeenCalledWith('/repo'));
    expect(api.git.commit).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPushStarted).toHaveBeenCalledWith('op-push'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not push when the commit fails and shows the error', async () => {
    const { api, onClose } = setup();
    api.git.commit.mockImplementationOnce(() =>
      Promise.resolve({ ok: false as const, error: { code: 'GIT_HOOK_FAILED' as const, message: 'hook recusou\nlint falhou' } }),
    );
    await ready();
    fireEvent.change(message(), { target: { value: 'envia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit e push' }));
    expect(await screen.findByText(/lint falhou/)).toBeTruthy();
    expect(api.git.push).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks for the push confirmations after a successful commit', async () => {
    const { api, onPushStarted } = setup();
    api.git.push.mockImplementationOnce(() =>
      okR({ needsConfirm: 'push-main' as const, details: { branch: 'main', remote: 'origin' } }),
    );
    await ready();
    fireEvent.change(message(), { target: { value: 'envia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Commit e push' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('main')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.git.push).toHaveBeenLastCalledWith('/repo', ['push-main']));
    await waitFor(() => expect(onPushStarted).toHaveBeenCalledWith('op-push'));
  });

  it('prefills the merge message and offers every file while merging', async () => {
    setup({ state: 'merging', mergeMessage: "Merge branch 'feature'" });
    await ready();
    expect((message() as HTMLTextAreaElement).value).toBe("Merge branch 'feature'");
    expect(screen.queryByLabelText('Alterar o último commit (amend)')).toBeNull();
    expect(screen.getByText(/todos os arquivos entram no commit/i)).toBeTruthy();
    expect(fileBox('README.md').disabled).toBe(true);
  });

  it('shows an empty state and a load error', async () => {
    setup({ changes: [] });
    expect(await screen.findByText(/Nenhuma alteração/)).toBeTruthy();
  });
});
