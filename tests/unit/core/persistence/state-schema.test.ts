import { describe, expect, it } from 'vitest';
import { emptyState, parseState, STATE_SCHEMA_VERSION } from '../../../../src/core/persistence/state-schema';

function file(schemaVersion: number, groups: unknown[], extra: Record<string, unknown> = {}) {
  return { ...emptyState(), schemaVersion, groups, ...extra };
}

describe('parseState — esquema 2 → 3', () => {
  it('uses schema version 3', () => {
    expect(STATE_SCHEMA_VERSION).toBe(3);
  });

  it('turns the repoPath of a v2 group into a one-folder workspace with that folder as primary', () => {
    const parsed = parseState(
      file(2, [{ id: 'g1', name: 'Site', order: 0, repoPath: '/repos/site', repoId: 'abc', colorIndex: 2 }]),
    );
    const group = parsed?.groups[0];
    expect(group?.folders).toHaveLength(1);
    const folder = group?.folders?.[0];
    expect(folder).toMatchObject({ path: '/repos/site' });
    expect(folder?.id).toBe('g1-0');
    expect(group?.primaryFolderId).toBe(folder?.id);
  });

  it('keeps repoPath and repoId, derived from the primary folder', () => {
    const group = parseState(
      file(2, [{ id: 'g1', name: 'Site', order: 0, repoPath: '/repos/site', repoId: 'abc' }]),
    )?.groups[0];
    expect(group).toMatchObject({ repoPath: '/repos/site', repoId: 'abc' });
  });

  it('leaves a v2 group without repoPath without folders', () => {
    const group = parseState(file(2, [{ id: 'g1', name: 'Manual', order: 0 }]))?.groups[0];
    expect(group?.folders).toBeUndefined();
    expect(group?.primaryFolderId).toBeUndefined();
  });

  it('reads a v3 state without changing it', () => {
    const groups = [
      {
        id: 'g1',
        name: 'Duplo',
        order: 0,
        folders: [
          { id: 'f1', path: '/a' },
          { id: 'f2', path: '/b' },
        ],
        primaryFolderId: 'f2',
        repoPath: '/b',
        repoId: 'xyz',
      },
    ];
    expect(parseState(file(3, groups))?.groups).toEqual(groups);
  });

  it('does not add extraDirs or notices to v2 tasks and executions', () => {
    const parsed = parseState(
      file(2, [], {
        tasks: [{ id: 't1', groupId: 'g1', repoPath: '/repos/site' }],
        executions: [{ id: 'e1', taskId: 't1' }],
      }),
    );
    expect(parsed?.tasks[0]).not.toHaveProperty('extraDirs');
    expect(parsed?.executions[0]).not.toHaveProperty('notices');
  });

  it('gives the migrated folder the same id on every read', () => {
    const v2 = file(2, [{ id: 'g1', name: 'Site', order: 0, repoPath: '/repos/site' }]);
    expect(parseState(v2)?.groups[0]?.folders).toEqual(parseState(v2)?.groups[0]?.folders);
  });

  it('reports the schema version of the file that was read', () => {
    expect(parseState(file(2, []))?.schemaVersion).toBe(2);
  });
});

describe('parseState — comandos de projeto (campos opcionais)', () => {
  const command = { commandId: 'c1', label: 'npm run dev', file: '/usr/bin/npm', args: ['run', 'dev'] };
  const stored = {
    id: 'c1',
    source: 'custom',
    label: 'Subir mock',
    program: 'node',
    args: ['mock/server.js'],
    folder: '/repos/site',
  };

  it('keeps Group.commands, Task.kind and Execution.command when reading and rewriting', () => {
    const raw = file(
      3,
      [{ id: 'g1', name: 'Site', order: 0, commands: [stored] }],
      {
        tasks: [{ id: 't1', groupId: 'g1', kind: 'command' }],
        executions: [{ id: 'e1', taskId: 't1', agentId: 'command', command }],
      },
    );
    const once = parseState(raw);
    expect(once?.groups[0]?.commands).toEqual([stored]);
    expect(once?.tasks[0]?.kind).toBe('command');
    expect(once?.executions[0]?.command).toEqual(command);
    const twice = parseState(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it('treats missing fields as agent data and does not add them', () => {
    const parsed = parseState(
      file(3, [{ id: 'g1', name: 'Site', order: 0 }], {
        tasks: [{ id: 't1', groupId: 'g1' }],
        executions: [{ id: 'e1', taskId: 't1', agentId: 'claude' }],
      }),
    );
    expect(parsed?.groups[0]).not.toHaveProperty('commands');
    expect(parsed?.tasks[0]).not.toHaveProperty('kind');
    expect(parsed?.executions[0]).not.toHaveProperty('command');
  });

  it('does not raise the schema version', () => {
    expect(STATE_SCHEMA_VERSION).toBe(3);
  });
});
