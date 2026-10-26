import { describe, expect, it } from 'vitest';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { emptyState, parseState, STATE_SCHEMA_VERSION } from '../../../../src/core/persistence/state-schema';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

function file(schemaVersion: number, groups: unknown[]) {
  return { ...emptyState(), schemaVersion, groups };
}

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  source: 'custom',
  label: 'Subir API',
  program: 'node',
  args: ['server.js', '--port', '4000'],
  folder: '/repos/api',
  ...over,
});

describe('parseState — esquema 3 → 4 (Group.commands → Group.runConfigs)', () => {
  it('uses schema version 4', () => {
    expect(STATE_SCHEMA_VERSION).toBe(4);
  });

  it('turns each stored command into a program run config keeping id, program, args and folder', () => {
    const group = parseState(file(3, [{ id: 'g1', name: 'W', order: 0, commands: [stored()] }]))?.groups[0];
    expect(group?.runConfigs).toEqual([
      {
        id: 'c1',
        name: 'Subir API',
        tool: 'program',
        folder: '/repos/api',
        script: null,
        program: 'node',
        args: ['server.js', '--port', '4000'],
        runtimeOptions: '',
        env: [],
        beforeLaunch: null,
        allowParallel: false,
        folderGroup: null,
        order: 0,
      },
    ]);
    expect('commands' in (group ?? {})).toBe(false);
  });

  it('orders the migrated configs by their position', () => {
    const group = parseState(
      file(3, [
        {
          id: 'g1',
          name: 'W',
          order: 0,
          commands: [stored({ id: 'a' }), stored({ id: 'b', label: 'B' }), stored({ id: 'c', label: 'C' })],
        },
      ]),
    )?.groups[0];
    expect(group?.runConfigs?.map((c) => [c.id, c.order])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('gives a group without commands an empty runConfigs', () => {
    const groups = parseState(
      file(3, [
        { id: 'g1', name: 'Sem', order: 0 },
        { id: 'g2', name: 'Vazio', order: 1, commands: [] },
      ]),
    )?.groups;
    expect(groups?.map((g) => g.runConfigs)).toEqual([[], []]);
  });

  it('migrates a v2 group through 3 to 4 as well', () => {
    const group = parseState(
      file(2, [{ id: 'g1', name: 'W', order: 0, repoPath: '/repos/api', commands: [stored()] }]),
    )?.groups[0];
    expect(group?.folders).toHaveLength(1);
    expect(group?.runConfigs?.[0]).toMatchObject({ id: 'c1', tool: 'program' });
  });

  it('keeps a v4 state as it is', () => {
    const runConfigs = [
      {
        id: 'r1',
        name: 'Start',
        tool: 'npm',
        folder: '/a',
        script: 'start',
        program: 'npm',
        args: [],
        runtimeOptions: '--inspect',
        env: [{ name: 'PORT', value: '4000' }],
        beforeLaunch: null,
        allowParallel: true,
        folderGroup: 'Web',
        order: 3,
      },
    ];
    expect(
      parseState(file(4, [{ id: 'g1', name: 'W', order: 0, runConfigs }]))?.groups[0]?.runConfigs,
    ).toEqual(runConfigs);
  });

  it('is idempotent: reading an already migrated group keeps its runConfigs', () => {
    const once = parseState(file(3, [{ id: 'g1', name: 'W', order: 0, commands: [stored()] }]));
    const twice = parseState(JSON.parse(JSON.stringify(once)));
    expect(twice?.groups[0]?.runConfigs).toEqual(once?.groups[0]?.runConfigs);
  });

  it('reports a future schema as read, so the store can refuse to overwrite it', () => {
    expect(parseState(file(5, [{ id: 'g1', name: 'W', order: 0 }]))?.schemaVersion).toBe(5);
  });
});

describe('StateStore — esquema 3 → 4', () => {
  function setup() {
    const fs = new MemoryFileSystem();
    fs.seed('/data/.keep', '');
    const clock = new FakeClock(Date.parse('2026-05-04T03:02:01.000Z'));
    const store = new StateStore(fs, '/data/state.json', clock, new MemoryLogger());
    return { fs, store };
  }

  it('copies the v3 file to state.v3.bak before the first v4 write, once', async () => {
    const { fs, store } = setup();
    const v3 = JSON.stringify(file(3, [{ id: 'g1', name: 'W', order: 0, commands: [stored()] }]));
    fs.seed('/data/state.json', v3);
    const { state } = await store.load();
    expect(await fs.exists('/data/state.v3.bak')).toBe(false);
    store.save(state);
    await store.flush();
    expect(fs.readText('/data/state.v3.bak')).toBe(v3);
    expect(JSON.parse(fs.readText('/data/state.json')).schemaVersion).toBe(4);
    expect(JSON.parse(fs.readText('/data/state.json')).groups[0].runConfigs[0].id).toBe('c1');
    store.save(state);
    await store.flush();
    expect(fs.readText('/data/state.v3.bak')).toBe(v3);
  });

  it('does not write a backup for a state that is already v4', async () => {
    const { fs, store } = setup();
    fs.seed('/data/state.json', JSON.stringify(file(4, [])));
    const { state } = await store.load();
    store.save(state);
    await store.flush();
    expect(await fs.exists('/data/state.v3.bak')).toBe(false);
  });

  it('refuses a v5 state without overwriting it', async () => {
    const { fs, store } = setup();
    const v5 = JSON.stringify(file(5, []));
    fs.seed('/data/state.json', v5);
    const result = await store.load();
    expect(result.readOnly).toBe(true);
    expect(result.warning).toBe('newer-schema');
    store.save(result.state);
    await store.flush();
    expect(fs.readText('/data/state.json')).toBe(v5);
  });

  it('keeps the active run id valid: the migrated config keeps the stored id', async () => {
    const { fs, store } = setup();
    fs.seed(
      '/data/state.json',
      JSON.stringify(file(3, [{ id: 'g1', name: 'W', order: 0, commands: [stored({ id: 'ativo' })] }])),
    );
    const { state } = await store.load();
    expect(state.groups[0]?.runConfigs?.map((c) => c.id)).toEqual(['ativo']);
  });
});
