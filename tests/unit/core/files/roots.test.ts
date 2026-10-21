import { describe, expect, it } from 'vitest';
import { navigationRoots } from '../../../../src/core/files/roots';
import type { Task } from '../../../../src/core/persistence/state-schema';
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
