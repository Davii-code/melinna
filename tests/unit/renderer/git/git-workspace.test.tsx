import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../../src/renderer/api';
import { GitWorkspaceProvider, useGitWorkspace, type GitWorkspace } from '../../../../src/renderer/git/git-workspace';
import type { Group, GitProgress, Result } from '../../../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from '../../../support/fake-api';

const group = (id: string, paths: string[]): Group => ({
  id,
  name: id,
  order: 0,
  folders: paths.map((path, i) => ({ id: `${id}-${i}`, path })),
  primaryFolderId: `${id}-0`,
  repoPath: paths[0] as string,
});

const change = (path: string, kind: 'modified' | 'untracked' = 'modified') => ({
  path,
  kind,
  indexChanged: false,
  worktreeChanged: true,
});

let current: GitWorkspace | null = null;
function Probe({ id }: { id?: string }) {
  const ws = useGitWorkspace();
  if (!id) current = ws;
  return (
    <p data-testid={id ?? 'probe'}>
      {ws.repos.map((r) => r.name).join(',')}|{ws.changeCount}|{String(ws.busy)}
    </p>
  );
}

function setup(workspace: Group | null, api = fakeApi(), availability: Record<string, boolean> = {}) {
  const view = (g: Group | null) => (
    <ApiContext.Provider value={api}>
      <GitWorkspaceProvider workspace={g} availability={availability}>
        <Probe />
        <Probe id="second" />
      </GitWorkspaceProvider>
    </ApiContext.Provider>
  );
  const utils = render(view(workspace));
  return { api, ...utils, rerenderWith: (g: Group | null) => utils.rerender(view(g)) };
}

const invalid: Promise<Result<never>> = Promise.resolve({
  ok: false,
  error: { code: 'REPO_INVALID', message: 'não é git' } as never,
});

describe('GitWorkspaceProvider', () => {
  it('loads every folder status before the first answer arrives', async () => {
    const api = fakeApi();
    const resolvers: (() => void)[] = [];
    api.git.status.mockImplementation(
      (repo: string) =>
        new Promise((resolve) => resolvers.push(() => resolve({ ok: true, value: repoStatus({ root: repo }) }))),
    );
    setup(group('w', ['/a', '/b', '/c']), api);
    await waitFor(() => expect(api.git.status).toHaveBeenCalledTimes(3));
    expect(resolvers).toHaveLength(3);
    await act(async () => resolvers.forEach((r) => r()));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('a,b,c|0|false'));
  });

  it('ignores folders without git and unavailable folders', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation((repo: string) =>
      repo === '/sem-git' ? invalid : okR(repoStatus({ root: repo, changes: [change('x.ts')] })),
    );
    setup(group('w', ['/ok', '/sem-git', '/off']), api, { 'w-2': false });
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ok|1|false'));
    expect(api.git.status).not.toHaveBeenCalledWith('/off');
  });

  it('rereads once per window focus even with two consumers', async () => {
    const { api } = setup(group('w', ['/a']));
    await waitFor(() => expect(api.git.status).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(api.git.status).toHaveBeenCalledTimes(2));
  });

  it('keeps the marks of files that remain changed when rereading', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation(() => okR(repoStatus({ root: '/a', changes: [change('x.ts'), change('y.ts')] })));
    setup(group('w', ['/a']), api);
    await waitFor(() => expect(current?.repos).toHaveLength(1));
    act(() => current?.setSelection(new Map([['/a', new Set(['x.ts'])]])));
    api.git.status.mockImplementation(() =>
      okR(repoStatus({ root: '/a', changes: [change('x.ts'), change('y.ts'), change('z.ts')] })),
    );
    await act(async () => current?.refresh());
    expect([...(current?.selection.get('/a') ?? [])].sort()).toEqual(['x.ts', 'z.ts']);
  });

  it('adopts an operation by opId, including an event that arrived before it', async () => {
    const { api } = setup(group('w', ['/a']));
    await waitFor(() => expect(current?.repos).toHaveLength(1));
    const early: GitProgress = { opId: 'op1', phase: 'Contando', percent: 40 };
    act(() => api.emitGitProgress(early));
    let settled: GitProgress | undefined;
    act(() => {
      void current?.waitOp('op1', { root: '/a', kind: 'push' }).then((e) => (settled = e));
    });
    expect(current?.ops.get('/a')).toMatchObject({ opId: 'op1', kind: 'push', phase: 'Contando', percent: 40 });
    act(() => api.emitGitProgress({ opId: 'op1', phase: 'fim', done: true }));
    await waitFor(() => expect(settled?.done).toBe(true));
    expect(current?.ops.size).toBe(0);
  });

  it('rereads at done', async () => {
    const { api } = setup(group('w', ['/a']));
    await waitFor(() => expect(current?.repos).toHaveLength(1));
    const before = api.git.status.mock.calls.length;
    act(() => {
      void current?.waitOp('op2', { root: '/a', kind: 'fetch' });
    });
    act(() => api.emitGitProgress({ opId: 'op2', phase: 'fim', done: true }));
    await waitFor(() => expect(api.git.status.mock.calls.length).toBeGreaterThan(before));
  });

  it('is busy during a sequence', async () => {
    setup(group('w', ['/a']));
    await waitFor(() => expect(current?.repos).toHaveLength(1));
    let release: () => void = () => undefined;
    let run: Promise<void> | undefined;
    act(() => {
      run = current?.runExclusive(() => new Promise<void>((r) => (release = r)));
    });
    expect(screen.getByTestId('probe').textContent).toMatch(/\|true$/);
    await act(async () => {
      release();
      await run;
    });
    expect(screen.getByTestId('probe').textContent).toMatch(/\|false$/);
  });

  it('drops the state of the previous workspace on switch', async () => {
    const api = fakeApi();
    api.git.status.mockImplementation((repo: string) => okR(repoStatus({ root: repo, changes: [change('x.ts')] })));
    const { rerenderWith } = setup(group('w1', ['/one']), api);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('one|1|false'));
    rerenderWith(group('w2', ['/two']));
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('two|1|false'));
    expect(current?.selection.has('/one')).toBe(false);
  });

  it('shows nothing without a workspace', async () => {
    const { api } = setup(null);
    expect(screen.getByTestId('probe').textContent).toBe('|0|false');
    expect(api.git.status).not.toHaveBeenCalled();
    expect(vi.isMockFunction(api.git.status)).toBe(true);
  });
});
