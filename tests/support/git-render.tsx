import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ApiContext } from '../../src/renderer/api';
import { GitWorkspaceProvider } from '../../src/renderer/git/git-workspace';
import type { Change, Group, RepoStatus } from '../../src/shared/ipc-contract';
import { fakeApi, okR, repoStatus } from './fake-api';

export type FakeApi = ReturnType<typeof fakeApi>;

const NO_AVAILABILITY: Record<string, boolean> = {};

export function change(path: string, kind: Change['kind'] = 'modified', extra: Partial<Change> = {}): Change {
  return { path, kind, indexChanged: false, worktreeChanged: true, ...extra };
}

export function workspaceOf(roots: string[]): Group {
  return {
    id: 'w',
    name: 'site',
    order: 0,
    folders: roots.map((path, i) => ({ id: `f${i}`, path })),
    primaryFolderId: 'f0',
    repoPath: roots[0] as string,
  };
}

/** Status por raiz; o que não estiver no mapa devolve um repositório limpo na raiz pedida. */
export function mockStatuses(api: FakeApi, byRoot: Record<string, Partial<RepoStatus>>): void {
  api.git.status.mockImplementation((repo: string) =>
    okR(repoStatus({ root: repo, ...(byRoot[repo] ?? {}) })),
  );
}

/** Renderiza `ui` dentro da API falsa e do provedor de git do workspace de `roots`. */
export function renderWithGit(
  ui: ReactNode,
  opts: {
    api?: FakeApi;
    roots?: string[];
    statuses?: Record<string, Partial<RepoStatus>>;
    workspace?: Group | null;
  } = {},
) {
  const api = opts.api ?? fakeApi();
  const roots = opts.roots ?? ['/repo'];
  if (opts.statuses) mockStatuses(api, opts.statuses);
  const workspace = opts.workspace === undefined ? workspaceOf(roots) : opts.workspace;
  const view = render(
    <ApiContext.Provider value={api}>
      <GitWorkspaceProvider workspace={workspace} availability={NO_AVAILABILITY}>
        {ui}
      </GitWorkspaceProvider>
    </ApiContext.Provider>,
  );
  return { api, ...view };
}
