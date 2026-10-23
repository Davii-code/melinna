import { describe, expect, it, vi } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import type { GitProgress } from '../../../../src/core/git/git-types';
import { registerGit, type GitApi } from '../../../../src/main/ipc/register-git';
import { handleRecorder } from '../../../support/fake-core';
import { MemoryLogger } from '../../../support/fakes/logger';
import { currentOs } from '../../../support/os';

const REPO = currentOs === 'win32' ? 'C:\\ws\\repo' : '/ws/repo';
const SHA = 'a'.repeat(40);

function fakeGit() {
  const status = { root: REPO, branch: 'main', changes: [] };
  return {
    status: vi.fn(async (_repo: string) => status),
    diffFile: vi.fn(async (_repo: string, path: string) => ({ path, change: 'modified', hunks: [], lineCount: 0 })),
    commit: vi.fn(async (_repo: string, _input: unknown) => ({ sha: SHA })),
    discard: vi.fn(async (_repo: string, _paths: string[], _confirm?: unknown) => undefined),
    checkPull: vi.fn(async (_repo: string, _confirm?: unknown) => null),
    checkPush: vi.fn(async (_repo: string, _confirm?: unknown) => null),
    fetch: vi.fn(async (_repo: string, _io: unknown) => undefined),
    pull: vi.fn(async (_repo: string, _io: unknown) => ({ conflicts: [] as string[] })),
    push: vi.fn(async (_repo: string, _io: unknown) => undefined),
    branches: vi.fn(async (_repo: string) => [{ name: 'main', kind: 'local', current: true }]),
    createBranch: vi.fn(async (_repo: string, _name: string) => undefined),
    checkout: vi.fn(async (_repo: string, _branch: string, _confirm?: unknown) => undefined),
    merge: vi.fn(async (_repo: string, _branch: string, _confirm?: unknown) => ({ conflicts: [] as string[] })),
    abortMerge: vi.fn(async (_repo: string, _confirm?: unknown) => undefined),
    markResolved: vi.fn(async (_repo: string, _paths: string[]) => undefined),
    log: vi.fn(async (_repo: string, _skip: number) => []),
    commitDiff: vi.fn(async (_repo: string, _sha: string, path: string) => ({
      path,
      change: 'modified',
      hunks: [],
      lineCount: 0,
    })),
  };
}

function setup() {
  const git = fakeGit();
  const rec = handleRecorder();
  const events: GitProgress[] = [];
  const log = new MemoryLogger();
  let n = 0;
  registerGit(rec.handle, {
    git: git as unknown as GitApi,
    roots: () => [REPO],
    os: currentOs,
    emit: (e) => events.push(e),
    log,
    newOpId: () => `op-${++n}`,
  });
  return { git, rec, events, log };
}

/** Espera os efeitos assíncronos da operação em segundo plano. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

describe('git IPC', () => {
  it('registers every git channel', () => {
    expect(setup().rec.channels()).toEqual([
      'git:abortMerge',
      'git:branches',
      'git:cancel',
      'git:checkout',
      'git:commit',
      'git:commitDiff',
      'git:createBranch',
      'git:diffFile',
      'git:discard',
      'git:fetch',
      'git:log',
      'git:markResolved',
      'git:merge',
      'git:pull',
      'git:push',
      'git:status',
    ]);
  });

  describe('repo validation', () => {
    it('refuses a repo that is not a registered workspace root', async () => {
      const { rec, git } = setup();
      for (const [channel, args] of [
        ['git:status', ['/outro/lugar']],
        ['git:commit', ['/outro/lugar', { paths: ['a'], message: 'x', amend: false }]],
        ['git:discard', ['/outro/lugar', ['a']]],
        ['git:fetch', ['/outro/lugar']],
        ['git:log', ['/outro/lugar', 0]],
      ] as const) {
        const r = await rec.call(channel, ...args);
        expect(r.ok).toBe(false);
        expect(r.error?.code).toBe('FILE_OUTSIDE_ROOT');
      }
      expect(git.status).not.toHaveBeenCalled();
      expect(git.commit).not.toHaveBeenCalled();
    });

    it('refuses non-string repo values', async () => {
      const { rec } = setup();
      expect((await rec.call('git:status', 42)).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('git:status')).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('status, diff, commit, discard', () => {
    it('answers the status of a registered root', async () => {
      const { rec, git } = setup();
      const r = await rec.call('git:status', REPO);
      expect(r).toMatchObject({ ok: true, value: { branch: 'main' } });
      expect(git.status).toHaveBeenCalledWith(REPO);
    });

    it('returns the diff of one file', async () => {
      const { rec, git } = setup();
      const r = await rec.call('git:diffFile', REPO, 'src/a.ts');
      expect(r).toMatchObject({ ok: true, value: { path: 'src/a.ts' } });
      expect(git.diffFile).toHaveBeenCalledWith(REPO, 'src/a.ts');
    });

    it('commits with validated paths, message and confirmations', async () => {
      const { rec, git } = setup();
      const r = await rec.call('git:commit', REPO, {
        paths: ['a.txt', 'dir/b.txt'],
        message: 'Mensagem\n\ncorpo',
        amend: false,
        confirm: ['amend-published'],
      });
      expect(r).toEqual({ ok: true, value: { sha: SHA } });
      expect(git.commit).toHaveBeenCalledWith(REPO, {
        paths: ['a.txt', 'dir/b.txt'],
        message: 'Mensagem\n\ncorpo',
        amend: false,
        confirm: ['amend-published'],
      });
    });

    it('allows an empty path list only with amend', async () => {
      const { rec, git } = setup();
      expect((await rec.call('git:commit', REPO, { paths: [], message: 'x', amend: false })).error?.code).toBe(
        'INPUT_INVALID',
      );
      expect((await rec.call('git:commit', REPO, { paths: [], message: 'x', amend: true })).ok).toBe(true);
      expect(git.commit).toHaveBeenCalledTimes(1);
    });

    it('validates the paths of commit, discard and markResolved', async () => {
      const { rec, git } = setup();
      const bad = ['../fora.txt', 'a/../../b', '-rf', '/abs/path', 'C:\\abs', 'com\u0000nulo', 'com\nquebra', '', 42];
      for (const path of bad) {
        expect((await rec.call('git:commit', REPO, { paths: [path], message: 'x', amend: false })).error?.code).toBe(
          'INPUT_INVALID',
        );
        expect((await rec.call('git:discard', REPO, [path])).error?.code).toBe('INPUT_INVALID');
        expect((await rec.call('git:markResolved', REPO, [path])).error?.code).toBe('INPUT_INVALID');
        expect((await rec.call('git:diffFile', REPO, path)).error?.code).toBe('INPUT_INVALID');
      }
      expect((await rec.call('git:commit', REPO, { paths: 'a.txt', message: 'x', amend: false })).error?.code).toBe(
        'INPUT_INVALID',
      );
      expect(git.commit).not.toHaveBeenCalled();
      expect(git.discard).not.toHaveBeenCalled();
    });

    it('accepts 5000 paths and refuses 5001', async () => {
      const { rec, git } = setup();
      const many = (n: number) => Array.from({ length: n }, (_, i) => `d/f${i}.txt`);
      expect((await rec.call('git:commit', REPO, { paths: many(5000), message: 'x', amend: false })).ok).toBe(true);
      expect((await rec.call('git:commit', REPO, { paths: many(5001), message: 'x', amend: false })).error?.code).toBe(
        'INPUT_INVALID',
      );
      expect(git.commit).toHaveBeenCalledTimes(1);
    });

    it('validates the message length', async () => {
      const { rec } = setup();
      const commit = (message: unknown) => rec.call('git:commit', REPO, { paths: ['a'], message, amend: false });
      expect((await commit('')).error?.code).toBe('INPUT_INVALID');
      expect((await commit('   ')).error?.code).toBe('INPUT_INVALID');
      expect((await commit(7)).error?.code).toBe('INPUT_INVALID');
      expect((await commit('x'.repeat(20_000))).ok).toBe(true);
      expect((await commit('x'.repeat(20_001))).error?.code).toBe('INPUT_INVALID');
    });

    it('validates the confirmations', async () => {
      const { rec } = setup();
      const r = await rec.call('git:discard', REPO, ['a'], ['apagar-tudo']);
      expect(r.error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('git:discard', REPO, ['a'], 'discard')).error?.code).toBe('INPUT_INVALID');
    });

    it('passes needsConfirm answers through', async () => {
      const { rec, git } = setup();
      const needs = { needsConfirm: 'discard', details: { files: [{ path: 'a', action: 'apagar' }] } };
      git.discard.mockResolvedValueOnce(needs as never);
      expect(await rec.call('git:discard', REPO, ['a'])).toEqual({ ok: true, value: needs });
      expect(git.discard).toHaveBeenCalledWith(REPO, ['a'], []);
    });

    it('turns core errors into error results and unknown ones into INTERNAL', async () => {
      const { rec, git, log } = setup();
      git.commit.mockRejectedValueOnce(new MelinnaError('GIT_HOOK_FAILED', { userMessage: 'hook recusou\nsaída' }));
      const r = await rec.call('git:commit', REPO, { paths: ['a'], message: 'x', amend: false });
      expect(r).toMatchObject({ ok: false, error: { code: 'GIT_HOOK_FAILED', message: 'hook recusou\nsaída' } });
      git.status.mockRejectedValueOnce(new TypeError('segredo'));
      const internal = await rec.call('git:status', REPO);
      expect(internal.error?.code).toBe('INTERNAL');
      expect(internal.error?.message).not.toContain('segredo');
      expect(log.text()).not.toContain('hook recusou');
    });
  });

  describe('network operations', () => {
    it('starts a fetch, returns the opId and emits progress and the end', async () => {
      const { rec, git, events } = setup();
      git.fetch.mockImplementationOnce(async (_repo: string, io: unknown) => {
        (io as { onProgress(p: string, n?: number): void }).onProgress('Recebendo objetos', 40);
      });
      const r = await rec.call('git:fetch', REPO);
      expect(r).toEqual({ ok: true, value: { opId: 'op-1' } });
      await settle();
      expect(events).toEqual([
        { opId: 'op-1', phase: 'Recebendo objetos', percent: 40 },
        { opId: 'op-1', phase: 'fetch', done: true },
      ]);
    });

    it('pulls with the confirmations and reports conflicts in the final event', async () => {
      const { rec, git, events } = setup();
      git.pull.mockResolvedValueOnce({ conflicts: ['a.txt'] });
      const r = await rec.call('git:pull', REPO, ['merge-dirty']);
      expect(r).toEqual({ ok: true, value: { opId: 'op-1' } });
      expect(git.checkPull).toHaveBeenCalledWith(REPO, ['merge-dirty']);
      await settle();
      expect(git.pull).toHaveBeenCalledWith(REPO, expect.objectContaining({ confirm: ['merge-dirty'] }));
      expect(events.at(-1)).toEqual({ opId: 'op-1', phase: 'pull', done: true, result: { conflicts: ['a.txt'] } });
    });

    it('asks for confirmation before starting a pull or a push', async () => {
      const { rec, git, events } = setup();
      const needs = { needsConfirm: 'push-main', details: { branch: 'main', remote: 'origin' } };
      git.checkPush.mockResolvedValueOnce(needs as never);
      expect(await rec.call('git:push', REPO)).toEqual({ ok: true, value: needs });
      git.checkPull.mockResolvedValueOnce({ needsConfirm: 'merge-dirty', details: { files: [] } } as never);
      expect((await rec.call('git:pull', REPO)).value).toMatchObject({ needsConfirm: 'merge-dirty' });
      await settle();
      expect(git.push).not.toHaveBeenCalled();
      expect(git.pull).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    });

    it('pushes after confirmation', async () => {
      const { rec, git, events } = setup();
      const r = await rec.call('git:push', REPO, ['push-main', 'set-upstream']);
      expect(r).toEqual({ ok: true, value: { opId: 'op-1' } });
      await settle();
      expect(git.push).toHaveBeenCalledWith(REPO, expect.objectContaining({ confirm: ['push-main', 'set-upstream'] }));
      expect(events.at(-1)).toEqual({ opId: 'op-1', phase: 'push', done: true });
    });

    it('emits the error in the final event when the operation fails', async () => {
      const { rec, git, events } = setup();
      git.push.mockRejectedValueOnce(new MelinnaError('GIT_AUTH'));
      await rec.call('git:push', REPO);
      await settle();
      expect(events.at(-1)).toMatchObject({ opId: 'op-1', done: true, error: { code: 'GIT_AUTH' } });
    });

    it('cancels a running operation by aborting its signal', async () => {
      const { rec, git, events } = setup();
      let signal: AbortSignal | undefined;
      git.fetch.mockImplementationOnce(
        (_repo: string, io: unknown) =>
          new Promise<undefined>((_resolve, reject) => {
            signal = (io as { signal: AbortSignal }).signal;
            signal.addEventListener('abort', () => reject(new MelinnaError('GIT_FAILED', { userMessage: 'Operação cancelada.' })));
          }),
      );
      await rec.call('git:fetch', REPO);
      expect(signal?.aborted).toBe(false);
      expect(await rec.call('git:cancel', 'op-1')).toEqual({ ok: true });
      expect(signal?.aborted).toBe(true);
      await settle();
      expect(events.at(-1)).toMatchObject({ opId: 'op-1', done: true, error: { message: 'Operação cancelada.' } });
    });

    it('refuses to cancel an unknown or finished operation', async () => {
      const { rec } = setup();
      expect((await rec.call('git:cancel', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
      await rec.call('git:fetch', REPO);
      await settle();
      expect((await rec.call('git:cancel', 'op-1')).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('git:cancel', 5)).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('branches and merge', () => {
    it('lists branches and creates one', async () => {
      const { rec, git } = setup();
      expect(await rec.call('git:branches', REPO)).toMatchObject({ ok: true, value: [{ name: 'main' }] });
      expect((await rec.call('git:createBranch', REPO, 'feature/nova')).ok).toBe(true);
      expect(git.createBranch).toHaveBeenCalledWith(REPO, 'feature/nova');
    });

    it('rejects branch names with a leading dash or control characters', async () => {
      const { rec, git } = setup();
      for (const name of ['-x', '--force', 'a\nb', '', 7]) {
        expect((await rec.call('git:createBranch', REPO, name)).error?.code).toBe('INPUT_INVALID');
        expect((await rec.call('git:checkout', REPO, name)).error?.code).toBe('INPUT_INVALID');
        expect((await rec.call('git:merge', REPO, name)).error?.code).toBe('INPUT_INVALID');
      }
      expect(git.createBranch).not.toHaveBeenCalled();
      expect(git.checkout).not.toHaveBeenCalled();
      expect(git.merge).not.toHaveBeenCalled();
    });

    it('checks out and merges with confirmations', async () => {
      const { rec, git } = setup();
      await rec.call('git:checkout', REPO, 'feature', ['checkout-dirty']);
      expect(git.checkout).toHaveBeenCalledWith(REPO, 'feature', ['checkout-dirty']);
      const r = await rec.call('git:merge', REPO, 'feature');
      expect(r).toEqual({ ok: true, value: { conflicts: [] } });
      expect(git.merge).toHaveBeenCalledWith(REPO, 'feature', []);
    });

    it('aborts a merge and marks files as resolved', async () => {
      const { rec, git } = setup();
      await rec.call('git:abortMerge', REPO, ['abort-merge']);
      expect(git.abortMerge).toHaveBeenCalledWith(REPO, ['abort-merge']);
      await rec.call('git:markResolved', REPO, ['a.txt']);
      expect(git.markResolved).toHaveBeenCalledWith(REPO, ['a.txt']);
      expect((await rec.call('git:markResolved', REPO, [])).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('history', () => {
    it('pages the log', async () => {
      const { rec, git } = setup();
      expect((await rec.call('git:log', REPO, 200)).ok).toBe(true);
      expect(git.log).toHaveBeenCalledWith(REPO, 200);
      for (const skip of [-1, 1.5, '0', undefined]) {
        expect((await rec.call('git:log', REPO, skip)).error?.code).toBe('INPUT_INVALID');
      }
    });

    it('returns the diff of a file in a commit and validates the sha', async () => {
      const { rec, git } = setup();
      const r = await rec.call('git:commitDiff', REPO, SHA, 'src/a.ts');
      expect(r).toMatchObject({ ok: true, value: { path: 'src/a.ts' } });
      expect(git.commitDiff).toHaveBeenCalledWith(REPO, SHA, 'src/a.ts');
      for (const sha of ['abc', 'g'.repeat(40), 'A'.repeat(40), '--output=x', 5, 'a'.repeat(65)]) {
        expect((await rec.call('git:commitDiff', REPO, sha, 'a')).error?.code).toBe('INPUT_INVALID');
      }
      expect((await rec.call('git:commitDiff', REPO, 'abcdef1', '../x')).error?.code).toBe('INPUT_INVALID');
    });
  });
});
