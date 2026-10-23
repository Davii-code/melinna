import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { emptyState, type Group } from '../../../../src/core/persistence/state-schema';
import {
  describeCustom,
  removeCustomCommand,
  saveCustomCommand,
  type CustomInput,
} from '../../../../src/core/run/custom-commands';
import { createFakeCore } from '../../../support/fake-core';
import { fakePlatform } from '../../../support/fakes/platform';

const platform = fakePlatform('linux', '/bin');

function group(over: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'App',
    order: 0,
    folders: [
      { id: 'f1', path: '/repo' },
      { id: 'f2', path: '/repo/api' },
    ],
    primaryFolderId: 'f1',
    repoPath: '/repo',
    ...over,
  };
}

function setup(g: Group = group()) {
  const state = emptyState();
  state.groups.push(g);
  const core = createFakeCore(state);
  return { core, model: core.model };
}

const input = (over: Partial<CustomInput> = {}): CustomInput => ({
  label: 'Servidor',
  program: 'node',
  args: ['server.js', '--porta', '3000'],
  folder: '/repo',
  ...over,
});

function failure(fn: () => unknown): MelinnaError {
  try {
    fn();
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('saveCustomCommand', () => {
  it('creates a configuration, persists it in Group.commands and reports created', () => {
    const { model } = setup();
    const { stored, created } = saveCustomCommand(model, 'g1', input(), 'linux');
    expect(created).toBe(true);
    expect(stored).toMatchObject({ source: 'custom', label: 'Servidor', program: 'node', folder: '/repo' });
    expect(stored.id).toBeTruthy();
    expect(model.group('g1')?.commands).toEqual([stored]);
  });

  it('edits in place when the id exists and reports created=false', () => {
    const { model } = setup();
    const { stored } = saveCustomCommand(model, 'g1', input(), 'linux');
    const edited = saveCustomCommand(model, 'g1', input({ id: stored.id, label: 'Novo', args: [] }), 'linux');
    expect(edited.created).toBe(false);
    expect(edited.stored).toMatchObject({ id: stored.id, label: 'Novo', args: [] });
    expect(model.group('g1')?.commands).toHaveLength(1);
  });

  it('refuses to edit a configuration that no longer exists', () => {
    const { model } = setup();
    expect(failure(() => saveCustomCommand(model, 'g1', input({ id: 'sumiu' }), 'linux')).code).toBe(
      'COMMAND_STALE',
    );
  });

  it('validates the name: 1 to 80 characters without line breaks', () => {
    const { model } = setup();
    for (const label of ['', '   ', 'x'.repeat(81), 'a\nb']) {
      expect(failure(() => saveCustomCommand(model, 'g1', input({ label }), 'linux')).code).toBe(
        'INPUT_INVALID',
      );
    }
    expect(() => saveCustomCommand(model, 'g1', input({ label: 'x'.repeat(80) }), 'linux')).not.toThrow();
  });

  it('trims the name', () => {
    const { model } = setup();
    expect(saveCustomCommand(model, 'g1', input({ label: '  Dev  ' }), 'linux').stored.label).toBe('Dev');
  });

  it('refuses a repeated name in the workspace regardless of case, but allows keeping its own', () => {
    const { model } = setup();
    const { stored } = saveCustomCommand(model, 'g1', input({ label: 'Servidor' }), 'linux');
    const err = failure(() => saveCustomCommand(model, 'g1', input({ label: 'SERVIDOR' }), 'linux'));
    expect(err.code).toBe('INPUT_INVALID');
    expect(err.userMessage).toBe('Já existe uma configuração com esse nome.');
    expect(() =>
      saveCustomCommand(model, 'g1', input({ id: stored.id, label: 'servidor' }), 'linux'),
    ).not.toThrow();
  });

  it('allows the same name in another workspace', () => {
    const state = emptyState();
    state.groups.push(group(), group({ id: 'g2', name: 'Outro' }));
    const { model } = createFakeCore(state);
    saveCustomCommand(model, 'g1', input(), 'linux');
    expect(() => saveCustomCommand(model, 'g2', input(), 'linux')).not.toThrow();
  });

  it('validates the program: required and without control characters', () => {
    const { model } = setup();
    for (const program of ['', 'no\nde', 'a\0b', 'x'.repeat(4097)]) {
      expect(failure(() => saveCustomCommand(model, 'g1', input({ program }), 'linux')).code).toBe(
        'INPUT_INVALID',
      );
    }
  });

  it('validates the arguments: up to 64, each up to 4096, no control characters', () => {
    const { model } = setup();
    expect(() =>
      saveCustomCommand(model, 'g1', input({ args: Array.from({ length: 64 }, () => 'a') }), 'linux'),
    ).not.toThrow();
    expect(() =>
      saveCustomCommand(model, 'g1', input({ label: 'b', args: ['x'.repeat(4096)] }), 'linux'),
    ).not.toThrow();
    for (const args of [Array.from({ length: 65 }, () => 'a'), ['x'.repeat(4097)], ['a\nb'], ['a\0b']]) {
      expect(failure(() => saveCustomCommand(model, 'g1', input({ label: 'c', args }), 'linux')).code).toBe(
        'INPUT_INVALID',
      );
    }
  });

  it('keeps arguments with spaces, quotes and shell characters as they are', () => {
    const { model } = setup();
    const args = ['-e', "console.log('oi mundo')", '; rm -rf /', '$(x)', ''];
    expect(saveCustomCommand(model, 'g1', input({ args }), 'linux').stored.args).toEqual(args);
  });

  it('accepts only a folder of the workspace', () => {
    const { model } = setup();
    expect(() => saveCustomCommand(model, 'g1', input({ folder: '/repo/api' }), 'linux')).not.toThrow();
    const err = failure(() =>
      saveCustomCommand(model, 'g1', input({ label: 'z', folder: '/outra' }), 'linux'),
    );
    expect(err.code).toBe('INPUT_INVALID');
    expect(err.userMessage).toBe('A pasta precisa ser do workspace.');
  });

  it('refuses an unknown workspace', () => {
    const { model } = setup();
    expect(failure(() => saveCustomCommand(model, 'nao', input(), 'linux')).code).toBe('INPUT_INVALID');
  });
});

describe('removeCustomCommand', () => {
  it('removes it from Group.commands', () => {
    const { model } = setup();
    const { stored } = saveCustomCommand(model, 'g1', input(), 'linux');
    removeCustomCommand(model, 'g1', stored.id);
    expect(model.group('g1')?.commands ?? []).toEqual([]);
  });

  it('reports COMMAND_STALE for an unknown id', () => {
    const { model } = setup();
    expect(failure(() => removeCustomCommand(model, 'g1', 'sumiu')).code).toBe('COMMAND_STALE');
  });
});

describe('describeCustom', () => {
  it('computes availability from the program and the workspace folders', async () => {
    const { core, model } = setup();
    core.fs.seed('/bin/node', 'bin');
    const { stored } = saveCustomCommand(model, 'g1', input(), 'linux');
    const g = model.group('g1') as Group;
    const deps = { fs: core.fs, platform };
    expect(await describeCustom(stored, g, deps)).toMatchObject({
      groupId: 'g1',
      source: 'custom',
      tool: 'custom',
      available: true,
      unavailableReason: null,
    });
    const missing = await describeCustom({ ...stored, program: 'nada' }, g, deps);
    expect(missing).toMatchObject({ available: false, unavailableReason: 'not-found', searched: 'nada' });
  });

  it('marks a folder removed from the workspace after saving as folder-outside', async () => {
    const { core, model } = setup();
    core.fs.seed('/bin/node', 'bin');
    const { stored } = saveCustomCommand(model, 'g1', input({ folder: '/repo/api' }), 'linux');
    const without = group({ folders: [{ id: 'f1', path: '/repo' }] });
    const r = await describeCustom(stored, without, { fs: core.fs, platform });
    expect(r).toMatchObject({ available: false, unavailableReason: 'folder-outside' });
  });
});
