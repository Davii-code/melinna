import { describe, expect, it } from 'vitest';
import { navigationRoots } from '../../../../src/core/files/roots';
import type { Group, Task } from '../../../../src/core/persistence/state-schema';
import { execution } from '../../../support/renderer-fixtures';

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    groupId: 'w1',
    title: 'Busca',
    prompt: '',
    repoPath: '/repos/site',
    repoId: 'r1',
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    slug: 'busca',
    createdAt: '2026-10-21T09:00:00.000Z',
    ...over,
  };
}

describe('navigationRoots', () => {
  it('returns one root per workspace and per prepared execution', () => {
    const roots = navigationRoots({
      groups: [
        { id: 'w1', name: 'site', order: 0, repoPath: '/repos/site' },
        { id: 'w2', name: 'api', order: 1, repoPath: '/repos/api' },
        { id: 'g3', name: 'Só grupo', order: 2 },
      ],
      tasks: [task()],
      executions: [
        execution('e1', { agentId: 'claude', worktreePath: '/wt/e1' }),
        execution('e2', { agentId: 'codex', worktreePath: '' }),
      ],
    });
    expect(roots).toEqual([
      { path: '/repos/site', label: 'site', kind: 'workspace' },
      { path: '/repos/api', label: 'api', kind: 'workspace' },
      { path: '/wt/e1', label: 'Busca · claude', kind: 'worktree', execId: 'e1' },
    ]);
  });

  it('does not repeat a path shared by two workspaces', () => {
    const roots = navigationRoots({
      groups: [
        { id: 'w1', name: 'a', order: 0, repoPath: '/repos/site' },
        { id: 'w2', name: 'b', order: 1, repoPath: '/repos/site' },
      ],
      tasks: [],
      executions: [],
    });
    expect(roots).toHaveLength(1);
  });
});

describe('navigationRoots — workspace com várias pastas', () => {
  const multi: Group = {
    id: 'w1',
    name: 'Plataforma',
    order: 0,
    folders: [
      { id: 'f1', path: '/repos/site' },
      { id: 'f2', path: '/repos/api' },
      { id: 'f3', path: '/repos/web' },
    ],
    primaryFolderId: 'f2',
    repoPath: '/repos/api',
  };

  it('emits one root per folder with the primary first and marked', () => {
    const roots = navigationRoots({ groups: [multi], tasks: [], executions: [] });
    expect(roots).toEqual([
      { path: '/repos/api', label: 'Plataforma · api', kind: 'workspace', workspaceId: 'w1', primary: true },
      { path: '/repos/site', label: 'Plataforma · site', kind: 'workspace', workspaceId: 'w1' },
      { path: '/repos/web', label: 'Plataforma · web', kind: 'workspace', workspaceId: 'w1' },
    ]);
  });

  it('flags an unavailable folder with available: false and leaves the others untouched', () => {
    const roots = navigationRoots({
      groups: [multi],
      tasks: [],
      executions: [],
      unavailableFolders: new Set(['f3']),
    });
    expect(roots.find((r) => r.path === '/repos/web')?.available).toBe(false);
    expect(roots.filter((r) => r.available === false)).toHaveLength(1);
  });

  it('does not duplicate a folder shared by two workspaces', () => {
    const other: Group = {
      id: 'w2',
      name: 'Outro',
      order: 1,
      folders: [
        { id: 'g1', path: '/repos/site' },
        { id: 'g2', path: '/repos/docs' },
      ],
      primaryFolderId: 'g2',
      repoPath: '/repos/docs',
    };
    const roots = navigationRoots({ groups: [multi, other], tasks: [], executions: [] });
    expect(roots.filter((r) => r.path === '/repos/site')).toHaveLength(1);
    expect(roots.map((r) => r.path)).toEqual([
      '/repos/api',
      '/repos/site',
      '/repos/web',
      '/repos/docs',
    ]);
  });

  it('keeps a migrated one-folder workspace as a single root named after the workspace', () => {
    const migrated: Group = {
      id: 'w3',
      name: 'site',
      order: 0,
      folders: [{ id: 'm1', path: '/repos/site' }],
      primaryFolderId: 'm1',
      repoPath: '/repos/site',
    };
    expect(navigationRoots({ groups: [migrated], tasks: [], executions: [] })).toEqual([
      { path: '/repos/site', label: 'site', kind: 'workspace' },
    ]);
  });

  it('keeps worktree roots after the workspace folders', () => {
    const roots = navigationRoots({
      groups: [multi],
      tasks: [task({ groupId: 'w1' })],
      executions: [execution('e1', { agentId: 'claude', worktreePath: '/wt/e1' })],
    });
    expect(roots.map((r) => r.kind)).toEqual(['workspace', 'workspace', 'workspace', 'worktree']);
  });
});
