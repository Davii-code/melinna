import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitPanel } from '../../../src/renderer/components/Git/CommitPanel';
import type { Commit, NeedsConfirm } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { change, renderWithGit, type FakeApi } from '../../support/git-render';

const base = {
  '/a': { branch: 'main', changes: [change('src/x.ts'), change('n.txt', 'untracked')] },
  '/b': { branch: 'dev', changes: [change('z.ts', 'added')] },
};

function setup(statuses: Record<string, object> = base, roots = ['/a', '/b']) {
  const api = fakeApi();
  const view = renderWithGit(<CommitPanel liveAgents={0} onOpenFile={vi.fn()} onShowDiff={vi.fn()} />, {
    api,
    roots,
    statuses: statuses as never,
  });
  return { ...view };
}

const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const box = () => screen.getByLabelText('Mensagem do commit') as HTMLTextAreaElement;
const write = (text: string) => fireEvent.change(box(), { target: { value: text } });
const need = (n: NeedsConfirm['needsConfirm'], details: NeedsConfirm['details'] = {}): never =>
  ({ needsConfirm: n, details }) as never;

/** Os pushes terminam sozinhos: o evento final chega logo depois da chamada. */
function autoFinishPush(api: FakeApi) {
  api.git.push.mockImplementation((repo: string) => {
    setTimeout(() => api.emitGitProgress({ opId: `op-${repo}`, phase: 'fim', done: true }), 0);
    return okR({ opId: `op-${repo}` });
  });
}

describe('CommitPanel commit', () => {
  it('lists Changes and Unversioned Files with counts and the branch of each repo', async () => {
    setup();
    await screen.findByText('Changes');
    expect(screen.getByText('Unversioned Files')).toBeTruthy();
    expect(screen.getAllByText('main').length).toBeGreaterThan(0);
    expect(screen.getAllByText('dev').length).toBeGreaterThan(0);
    expect(screen.getByText('2 files')).toBeTruthy();
    expect((screen.getByLabelText('Selecionar n.txt') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Selecionar x.ts') as HTMLInputElement).checked).toBe(true);
  });

  it('disables Commit without marked files or without a message, with the hint', async () => {
    setup();
    await screen.findByText('x.ts');
    expect(button('Commit').disabled).toBe(true);
    expect(button('Commit').title).toBe('Escreva a mensagem');
    write('feat: algo');
    expect(button('Commit').disabled).toBe(false);
    fireEvent.click(screen.getByLabelText('Selecionar Changes'));
    expect(button('Commit').disabled).toBe(true);
    expect(button('Commit').title).toBe('Marque ao menos um arquivo');
    expect(button('Commit and Push…').disabled).toBe(true);
  });

  it('one click on Commit commits both repos in sequence with the same message and clears it', async () => {
    const { api } = setup();
    await screen.findByText('x.ts');
    write('feat: dois repos');
    fireEvent.click(button('Commit'));
    await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(2));
    expect(api.git.commit.mock.calls.map((c) => [c[0], c[1].paths, c[1].message, c[1].amend])).toEqual([
      ['/a', ['src/x.ts'], 'feat: dois repos', false],
      ['/b', ['z.ts'], 'feat: dois repos', false],
    ]);
    await waitFor(() => expect(box().value).toBe(''));
    expect(screen.getByText(/a: commitado/)).toBeTruthy();
    expect(screen.getByText(/b: commitado/)).toBeTruthy();
  });

  it('includes a marked unversioned file in its repo commit', async () => {
    const { api } = setup();
    await screen.findByText('x.ts');
    fireEvent.click(screen.getByLabelText('Selecionar n.txt'));
    write('add n');
    fireEvent.click(button('Commit'));
    await waitFor(() => expect(api.git.commit).toHaveBeenCalled());
    expect(api.git.commit.mock.calls[0]?.[1].paths).toEqual(['src/x.ts', 'n.txt']);
  });

  it('shows the failing repo and reason, keeps the message and the finished commits', async () => {
    const { api } = setup();
    await screen.findByText('x.ts');
    api.git.commit.mockImplementationOnce(() => okR({ sha: '1'.repeat(40) }));
    api.git.commit.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'GIT_FAILED' as const, message: 'hook recusou' },
      }),
    );
    write('feat: falha');
    fireEvent.click(button('Commit'));
    expect(await screen.findByText(/b: falhou: hook recusou/)).toBeTruthy();
    expect(screen.getByText(/a: commitado/)).toBeTruthy();
    expect(box().value).toBe('feat: falha');
  });

  it('Commit and Push… pushes every committed repo, asking push-main per repo', async () => {
    const { api } = setup();
    await screen.findByText('x.ts');
    autoFinishPush(api);
    api.git.push.mockImplementationOnce(() => okR(need('push-main', { branch: 'main' })));
    write('feat: push');
    fireEvent.click(button('Commit and Push…'));
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(api.git.push).toHaveBeenCalledTimes(3));
    expect(api.git.push.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['/a', undefined],
      ['/a', ['push-main']],
      ['/b', undefined],
    ]);
    expect(await screen.findByText(/b: push enviado/)).toBeTruthy();
  });

  it('refusing a push confirmation skips that repo and goes on', async () => {
    const { api } = setup();
    await screen.findByText('x.ts');
    autoFinishPush(api);
    api.git.push.mockImplementationOnce(() => okR(need('push-main', { branch: 'main' })));
    write('feat: push');
    fireEvent.click(button('Commit and Push…'));
    await screen.findByRole('button', { name: 'Enviar' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(api.git.push).toHaveBeenCalledTimes(2));
    expect(api.git.commit).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/a: push não enviado/)).toBeTruthy();
    expect(await screen.findByText(/b: push enviado/)).toBeTruthy();
  });

  it('does not push anything when a commit failed', async () => {
    const { api } = setup();
    await screen.findByText('x.ts');
    api.git.commit.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'GIT_FAILED' as const, message: 'sem identidade' },
      }),
    );
    write('feat: x');
    fireEvent.click(button('Commit and Push…'));
    expect(await screen.findByText(/a: falhou: sem identidade/)).toBeTruthy();
    expect(api.git.push).not.toHaveBeenCalled();
  });

  describe('Amend', () => {
    const last: Commit = {
      sha: 'f'.repeat(40),
      shortSha: 'fffffff',
      author: 'x',
      email: 'x@x',
      date: '2026-10-22T10:00:00-03:00',
      subject: 'fix: antigo',
      body: 'detalhe',
      files: [],
    };

    it('loads the last message when the box is empty and applies to the marked repos', async () => {
      const { api } = setup();
      await screen.findByText('x.ts');
      api.git.log.mockImplementation(() => okR([last]));
      fireEvent.click(screen.getByLabelText('Amend'));
      await waitFor(() => expect(box().value).toBe('fix: antigo\n\ndetalhe'));
      expect(api.git.log).toHaveBeenCalledWith('/a', 0);
      fireEvent.click(button('Commit'));
      await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(2));
      expect(api.git.commit.mock.calls.every((c) => c[1].amend)).toBe(true);
    });

    it('keeps a message that was already typed', async () => {
      const { api } = setup();
      await screen.findByText('x.ts');
      write('minha');
      fireEvent.click(screen.getByLabelText('Amend'));
      expect(box().value).toBe('minha');
      expect(api.git.log).not.toHaveBeenCalled();
    });

    it('asks which repository when several are present and none is marked', async () => {
      const { api } = setup();
      await screen.findByText('x.ts');
      fireEvent.click(screen.getByLabelText('Selecionar Changes'));
      fireEvent.click(screen.getByLabelText('Amend'));
      write('reescrito');
      expect(button('Commit').disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Repositório do amend'), { target: { value: '/b' } });
      expect(button('Commit').disabled).toBe(false);
      fireEvent.click(button('Commit'));
      await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(1));
      expect(api.git.commit.mock.calls[0]?.[0]).toBe('/b');
      expect(api.git.commit.mock.calls[0]?.[1]).toMatchObject({ paths: [], amend: true });
    });

    it('uses the only repository without asking', async () => {
      const { api } = setup({ '/a': { changes: [change('x.ts')] } }, ['/a']);
      await screen.findByText('x.ts');
      fireEvent.click(screen.getByLabelText('Selecionar Changes'));
      fireEvent.click(screen.getByLabelText('Amend'));
      write('reescrito');
      expect(screen.queryByLabelText('Repositório do amend')).toBeNull();
      fireEvent.click(button('Commit'));
      await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(1));
    });

    it('asks to confirm amending a published commit', async () => {
      const { api } = setup({ '/a': { changes: [change('x.ts')] } }, ['/a']);
      await screen.findByText('x.ts');
      api.git.commit.mockImplementationOnce(() => okR(need('amend-published')));
      fireEvent.click(screen.getByLabelText('Amend'));
      write('m');
      fireEvent.click(button('Commit'));
      fireEvent.click(await screen.findByRole('button', { name: 'Alterar mesmo assim' }));
      await waitFor(() => expect(api.git.commit).toHaveBeenCalledTimes(2));
      expect(api.git.commit.mock.calls[1]?.[1].confirm).toEqual(['amend-published']);
    });
  });
});
