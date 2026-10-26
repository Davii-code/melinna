import { describe, expect, it, vi } from 'vitest';
import {
  commitAll,
  commitAndPush,
  fetchAll,
  pullAll,
  pushAll,
  type GitApi,
} from '../../../../src/renderer/git/sequence';
import type { PlanItem, RepoView } from '../../../../src/renderer/git/git-store';
import type { GitProgress, NeedsConfirm, Result } from '../../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from '../../../support/fake-api';

const view = (name: string): RepoView => ({
  folderId: `f-${name}`,
  root: `/w/${name}`,
  name,
  status: repoStatus({ root: `/w/${name}` }),
});
const a = view('a');
const b = view('b');
const c = view('c');
const plan = (...repos: RepoView[]): PlanItem[] => repos.map((repo) => ({ repo, paths: [`${repo.name}.ts`] }));
const need = (confirm: NeedsConfirm['needsConfirm']): NeedsConfirm => ({ needsConfirm: confirm, details: {} });
const fail = (message: string): Promise<Result<never>> =>
  Promise.resolve({ ok: false, error: { code: 'INVALID_INPUT', message } as never });

function setup() {
  const api = fakeApi();
  const done = (opId: string): Promise<GitProgress> => Promise.resolve({ opId, phase: 'fim', done: true });
  return { api, git: api.git as unknown as GitApi, wait: vi.fn(done), ask: vi.fn((_r: NeedsConfirm, _v: RepoView) => Promise.resolve(true)) };
}

describe('commitAll', () => {
  it('commits in order with the same message', async () => {
    const { api, git, ask } = setup();
    const r = await commitAll(git, plan(a, b), 'msg', false, ask);
    expect(api.git.commit.mock.calls.map((x) => [x[0], x[1].message, x[1].paths, x[1].amend])).toEqual([
      ['/w/a', 'msg', ['a.ts'], false],
      ['/w/b', 'msg', ['b.ts'], false],
    ]);
    expect(r.failed).toBe(false);
    expect(r.results.map((x) => [x.name, x.outcome, x.sha])).toEqual([
      ['a', 'ok', 'c'.repeat(40)],
      ['b', 'ok', 'c'.repeat(40)],
    ]);
  });

  it('stops at the first error keeping the commits already made', async () => {
    const { api, git, ask } = setup();
    api.git.commit.mockImplementationOnce(() => okR({ sha: '1'.repeat(40) }));
    api.git.commit.mockImplementationOnce(() => fail('hook falhou'));
    const r = await commitAll(git, plan(a, b, c), 'msg', false, ask);
    expect(api.git.commit).toHaveBeenCalledTimes(2);
    expect(r.failed).toBe(true);
    expect(r.results.map((x) => [x.name, x.outcome, x.message])).toEqual([
      ['a', 'ok', undefined],
      ['b', 'error', 'hook falhou'],
    ]);
  });

  it('pauses on needsConfirm until the answer and repeats with the confirmation', async () => {
    const { api, git, ask } = setup();
    api.git.commit.mockImplementationOnce(() => okR<never>(need('amend-published') as never));
    const r = await commitAll(git, plan(a), 'm', true, ask);
    expect(ask).toHaveBeenCalledWith(need('amend-published'), a);
    expect(api.git.commit.mock.calls[1]?.[1].confirm).toEqual(['amend-published']);
    expect(r.results[0]?.outcome).toBe('ok');
  });

  it('skips a repo whose confirmation is refused and goes on', async () => {
    const { api, git, ask } = setup();
    api.git.commit.mockImplementationOnce(() => okR<never>(need('amend-published') as never));
    ask.mockResolvedValueOnce(false);
    const r = await commitAll(git, plan(a, b), 'm', true, ask);
    expect(r.results.map((x) => [x.name, x.outcome])).toEqual([
      ['a', 'skipped'],
      ['b', 'ok'],
    ]);
    expect(r.failed).toBe(false);
  });
});

describe('commitAndPush', () => {
  it('pushes every committed repo after all commits succeeded', async () => {
    const { api, git, ask, wait } = setup();
    const r = await commitAndPush(git, plan(a, b), 'm', false, ask, wait);
    expect(api.git.push.mock.calls.map((x) => x[0])).toEqual(['/w/a', '/w/b']);
    expect(r.commits.failed).toBe(false);
    expect(r.pushes.map((x) => x.outcome)).toEqual(['ok', 'ok']);
  });

  it('does not push anything when a commit failed', async () => {
    const { api, git, ask, wait } = setup();
    api.git.commit.mockImplementationOnce(() => okR({ sha: '1'.repeat(40) }));
    api.git.commit.mockImplementationOnce(() => fail('sem identidade'));
    const r = await commitAndPush(git, plan(a, b), 'm', false, ask, wait);
    expect(api.git.push).not.toHaveBeenCalled();
    expect(r.pushes).toEqual([]);
    expect(r.commits.failed).toBe(true);
  });
});

describe('pushAll', () => {
  it('runs one at a time, waiting for each operation', async () => {
    const { api, git, ask } = setup();
    const order: string[] = [];
    const wait = vi.fn(async (opId: string) => {
      order.push(`wait:${opId}`);
      return { opId, phase: 'fim', done: true } as GitProgress;
    });
    api.git.push.mockImplementation((repo: string) => {
      order.push(`push:${repo}`);
      return okR({ opId: `op-${repo}` });
    });
    await pushAll(git, [a, b], ask, wait);
    expect(order).toEqual(['push:/w/a', 'wait:op-/w/a', 'push:/w/b', 'wait:op-/w/b']);
  });

  it('asks per repo: accept repeats with the accumulated confirmation, refuse skips and goes on', async () => {
    const { api, git, ask, wait } = setup();
    api.git.push.mockImplementationOnce(() => okR<never>(need('push-main') as never));
    api.git.push.mockImplementationOnce(() => okR<never>(need('set-upstream') as never));
    api.git.push.mockImplementationOnce(() => okR({ opId: 'x' }));
    api.git.push.mockImplementationOnce(() => okR<never>(need('push-main') as never));
    ask.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const r = await pushAll(git, [a, b], ask, wait);
    expect(api.git.push.mock.calls.map((x) => [x[0], x[1]])).toEqual([
      ['/w/a', undefined],
      ['/w/a', ['push-main']],
      ['/w/a', ['push-main', 'set-upstream']],
      ['/w/b', undefined],
    ]);
    expect(r.map((x) => [x.name, x.outcome])).toEqual([
      ['a', 'ok'],
      ['b', 'skipped'],
    ]);
  });

  it('reports an error from the call or from the finished operation and keeps going', async () => {
    const { api, git, ask } = setup();
    api.git.push.mockImplementationOnce(() => fail('rejeitado'));
    api.git.push.mockImplementationOnce(() => okR({ opId: 'op-b' }));
    const wait = vi.fn(
      async (opId: string) =>
        ({ opId, phase: 'fim', done: true, error: { code: 'GIT_AUTH', message: 'sem credencial' } }) as GitProgress,
    );
    const r = await pushAll(git, [a, b], ask, wait);
    expect(r.map((x) => [x.name, x.outcome, x.message])).toEqual([
      ['a', 'error', 'rejeitado'],
      ['b', 'error', 'sem credencial'],
    ]);
  });
});

describe('fetchAll / pullAll', () => {
  it('fetches in sequence with a result per repo', async () => {
    const { api, git, wait } = setup();
    const r = await fetchAll(git, [a, b], wait);
    expect(api.git.fetch.mock.calls.map((x) => x[0])).toEqual(['/w/a', '/w/b']);
    expect(r.map((x) => x.outcome)).toEqual(['ok', 'ok']);
  });

  it('pulls in sequence and reports conflicts', async () => {
    const { api, git, ask } = setup();
    const wait = vi.fn(
      async (opId: string) =>
        ({ opId, phase: 'fim', done: true, result: { conflicts: ['x.ts'] } }) as GitProgress,
    );
    const r = await pullAll(git, [a, b], ask, wait);
    expect(api.git.pull).toHaveBeenCalledTimes(2);
    expect(r[0]?.conflicts).toEqual(['x.ts']);
  });
});
