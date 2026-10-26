import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { emptyState, type Group } from '../../../../src/core/persistence/state-schema';
import { launchPlan, removeConfig, reorder, saveConfig, toView } from '../../../../src/core/run/run-configs';
import type { RunConfig, RunConfigInput } from '../../../../src/core/run/types';
import { createFakeCore } from '../../../support/fake-core';
import type { MemoryFileSystem } from '../../../support/fakes/file-system';
import { fakePlatform } from '../../../support/fakes/platform';

const linux = fakePlatform('linux', '/bin');
const win = fakePlatform('win32', 'C:\\tools', ['.EXE', '.CMD', '.BAT']);

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

function setup(g: Group = group(), platform = linux) {
  const state = emptyState();
  state.groups.push(g);
  const core = createFakeCore(state);
  core.fs.seed('/repo/package.json', JSON.stringify({ scripts: { start: 'node .', build: 'tsc' } }));
  for (const bin of ['npm', 'pnpm', 'yarn', 'mvn', 'gradle', 'docker', 'node'])
    core.fs.seed(`/bin/${bin}`, 'bin');
  return { core, model: core.model, deps: { fs: core.fs as MemoryFileSystem, platform } };
}

const program = (over: Partial<RunConfigInput> = {}): RunConfigInput => ({
  name: 'Servidor',
  tool: 'program',
  folder: '/repo',
  script: null,
  program: 'node',
  args: ['server.js'],
  runtimeOptions: '',
  env: [],
  beforeLaunch: null,
  allowParallel: false,
  folderGroup: null,
  ...over,
});

const npm = (over: Partial<RunConfigInput> = {}): RunConfigInput =>
  program({ name: 'Start', tool: 'npm', script: 'start', program: '', args: [], ...over });

async function failure(p: Promise<unknown> | (() => unknown)): Promise<MelinnaError> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('saveConfig — criar e editar', () => {
  it('creates a config in Group.runConfigs with a generated id and the next order', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const b = await saveConfig(model, 'g1', program({ name: 'B' }), deps);
    expect(a.id).toBeTruthy();
    expect([a.order, b.order]).toEqual([0, 1]);
    expect(model.group('g1')?.runConfigs).toEqual([a, b]);
  });

  it('numbers the order inside each group (tool + folder group)', async () => {
    const { model, deps } = setup();
    await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const s = await saveConfig(model, 'g1', npm(), deps);
    const f = await saveConfig(model, 'g1', npm({ name: 'Start 2', folderGroup: 'Web' }), deps);
    expect([s.order, f.order]).toEqual([0, 0]);
  });

  it('edits in place keeping the order, and moves to the end when the group changes', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    await saveConfig(model, 'g1', program({ name: 'B' }), deps);
    const edited = await saveConfig(model, 'g1', program({ id: a.id, name: 'A2' }), deps);
    expect(edited).toMatchObject({ id: a.id, name: 'A2', order: 0 });
    expect(model.group('g1')?.runConfigs).toHaveLength(2);
    const other = await saveConfig(model, 'g1', program({ name: 'C', folderGroup: 'X' }), deps);
    expect(other.order).toBe(0);
    const moved = await saveConfig(model, 'g1', program({ id: a.id, name: 'A2', folderGroup: 'X' }), deps);
    expect(moved.order).toBe(1);
  });

  it('refuses to edit a config that no longer exists', async () => {
    const { model, deps } = setup();
    expect((await failure(saveConfig(model, 'g1', program({ id: 'sumiu' }), deps))).code).toBe(
      'RUN_CONFIG_MISSING',
    );
  });

  it('refuses an unknown workspace', async () => {
    const { model, deps } = setup();
    expect((await failure(saveConfig(model, 'nao', program(), deps))).code).toBe('INPUT_INVALID');
  });
});

describe('saveConfig — nome', () => {
  it('validates the name: 1 to 80 characters without line breaks, trimmed', async () => {
    const { model, deps } = setup();
    for (const name of ['', '   ', 'x'.repeat(81), 'a\nb']) {
      const err = await failure(saveConfig(model, 'g1', program({ name }), deps));
      expect(err.code).toBe('RUN_CONFIG_INVALID');
      expect(err.details?.field).toBe('name');
    }
    expect((await saveConfig(model, 'g1', program({ name: '  Dev  ' }), deps)).name).toBe('Dev');
    await expect(saveConfig(model, 'g1', program({ name: 'x'.repeat(80) }), deps)).resolves.toBeTruthy();
  });

  it('refuses a repeated name regardless of case, but allows keeping its own', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'Servidor' }), deps);
    const err = await failure(saveConfig(model, 'g1', program({ name: 'SERVIDOR' }), deps));
    expect(err.code).toBe('RUN_CONFIG_INVALID');
    expect(err.userMessage).toBe('Já existe uma configuração com esse nome.');
    await expect(
      saveConfig(model, 'g1', program({ id: a.id, name: 'servidor' }), deps),
    ).resolves.toBeTruthy();
  });

  it('allows the same name in another workspace', async () => {
    const state = emptyState();
    state.groups.push(group(), group({ id: 'g2', name: 'Outro' }));
    const core = createFakeCore(state);
    const deps = { fs: core.fs, platform: linux };
    await saveConfig(core.model, 'g1', program(), deps);
    await expect(saveConfig(core.model, 'g2', program(), deps)).resolves.toBeTruthy();
  });
});

describe('saveConfig — pasta e script', () => {
  it('accepts only a folder of the workspace', async () => {
    const { model, deps } = setup();
    await expect(saveConfig(model, 'g1', program({ folder: '/repo/api' }), deps)).resolves.toBeTruthy();
    const err = await failure(saveConfig(model, 'g1', program({ name: 'z', folder: '/outra' }), deps));
    expect(err.code).toBe('RUN_CONFIG_INVALID');
    expect(err.details?.field).toBe('folder');
    expect(err.userMessage).toBe('A pasta precisa ser do workspace.');
  });

  it('requires an npm/pnpm/yarn script among the ones detected in the folder', async () => {
    const { model, deps } = setup();
    await expect(saveConfig(model, 'g1', npm({ script: 'build' }), deps)).resolves.toMatchObject({
      script: 'build',
    });
    for (const script of ['deploy', '', null]) {
      const err = await failure(saveConfig(model, 'g1', npm({ name: `S${script}`, script }), deps));
      expect(err.code).toBe('RUN_CONFIG_INVALID');
      expect(err.details?.field).toBe('script');
    }
    const noPackage = await failure(saveConfig(model, 'g1', npm({ name: 'api', folder: '/repo/api' }), deps));
    expect(noPackage.details?.field).toBe('script');
  });

  it('requires objectives for maven and tasks for gradle', async () => {
    const { model, deps } = setup();
    const maven = await saveConfig(
      model,
      'g1',
      program({ name: 'M', tool: 'maven', script: 'clean install' }),
      deps,
    );
    expect(maven.script).toBe('clean install');
    const err = await failure(
      saveConfig(model, 'g1', program({ name: 'G', tool: 'gradle', script: '   ' }), deps),
    );
    expect(err.details?.field).toBe('script');
  });

  it('forces script to null in compose and program', async () => {
    const { model, deps } = setup();
    const c = await saveConfig(model, 'g1', program({ name: 'C', tool: 'compose', script: 'up' }), deps);
    const p = await saveConfig(model, 'g1', program({ name: 'P', script: 'x' }), deps);
    expect([c.script, p.script]).toEqual([null, null]);
  });
});

describe('saveConfig — programa derivado', () => {
  it('ignores the program sent for the tools and derives it', async () => {
    const { model, deps } = setup();
    const npmCfg = await saveConfig(model, 'g1', npm({ program: 'calc.exe' }), deps);
    expect(npmCfg.program).toBe('npm');
    const mvn = await saveConfig(
      model,
      'g1',
      program({ name: 'M', tool: 'maven', script: 'test', program: 'x' }),
      deps,
    );
    expect(mvn.program).toBe('mvn');
    const dc = await saveConfig(model, 'g1', program({ name: 'D', tool: 'compose', program: 'x' }), deps);
    expect(dc.program).toBe('docker');
  });

  it('uses the project wrapper when it exists (POSIX)', async () => {
    const { model, deps, core } = setup();
    core.fs.seed('/repo/mvnw', 'sh');
    core.fs.seed('/repo/gradlew', 'sh');
    const mvn = await saveConfig(model, 'g1', program({ name: 'M', tool: 'maven', script: 'test' }), deps);
    const gradle = await saveConfig(
      model,
      'g1',
      program({ name: 'G', tool: 'gradle', script: 'build' }),
      deps,
    );
    expect(mvn.program).toBe('/repo/mvnw');
    expect(gradle.program).toBe('/repo/gradlew');
  });

  it('requires the program in the program tool, without control characters', async () => {
    const { model, deps } = setup();
    for (const p of ['', 'no\nde', 'a\0b', 'x'.repeat(4097)]) {
      const err = await failure(saveConfig(model, 'g1', program({ program: p }), deps));
      expect(err.code).toBe('RUN_CONFIG_INVALID');
      expect(err.details?.field).toBe('program');
    }
  });
});

describe('saveConfig — limites', () => {
  it('validates the arguments: up to 64, each up to 4096, no control characters', async () => {
    const { model, deps } = setup();
    await expect(
      saveConfig(model, 'g1', program({ args: Array.from({ length: 64 }, () => 'a') }), deps),
    ).resolves.toBeTruthy();
    await expect(
      saveConfig(model, 'g1', program({ name: 'b', args: ['x'.repeat(4096)] }), deps),
    ).resolves.toBeTruthy();
    for (const args of [Array.from({ length: 65 }, () => 'a'), ['x'.repeat(4097)], ['a\nb'], ['a\0b']]) {
      const err = await failure(saveConfig(model, 'g1', program({ name: 'c', args }), deps));
      expect(err.code).toBe('RUN_CONFIG_INVALID');
      expect(err.details?.field).toBe('args');
    }
  });

  it('keeps arguments with spaces, quotes and shell characters as they are', async () => {
    const { model, deps } = setup();
    const args = ['-e', "console.log('oi mundo')", '; rm -rf /', '$(x)', ''];
    expect((await saveConfig(model, 'g1', program({ args }), deps)).args).toEqual(args);
  });

  it('limits runtimeOptions to 1,000 characters and clears it in compose and program', async () => {
    const { model, deps } = setup();
    await expect(
      saveConfig(model, 'g1', npm({ runtimeOptions: 'x'.repeat(1000) }), deps),
    ).resolves.toBeTruthy();
    const err = await failure(
      saveConfig(model, 'g1', npm({ name: 'y', runtimeOptions: 'x'.repeat(1001) }), deps),
    );
    expect(err.details?.field).toBe('runtimeOptions');
    const p = await saveConfig(model, 'g1', program({ runtimeOptions: '--inspect' }), deps);
    const c = await saveConfig(
      model,
      'g1',
      program({ name: 'C', tool: 'compose', runtimeOptions: '-X' }),
      deps,
    );
    expect([p.runtimeOptions, c.runtimeOptions]).toEqual(['', '']);
  });

  it('limits folderGroup to 1–60 characters (blank means none)', async () => {
    const { model, deps } = setup();
    expect((await saveConfig(model, 'g1', program({ folderGroup: 'x'.repeat(60) }), deps)).folderGroup).toBe(
      'x'.repeat(60),
    );
    const err = await failure(
      saveConfig(model, 'g1', program({ name: 'b', folderGroup: 'x'.repeat(61) }), deps),
    );
    expect(err.details?.field).toBe('folderGroup');
    expect(
      (await saveConfig(model, 'g1', program({ name: 'c', folderGroup: '  ' }), deps)).folderGroup,
    ).toBeNull();
  });
});

describe('saveConfig — variáveis de ambiente', () => {
  const env = (...pairs: [string, string][]) => pairs.map(([name, value]) => ({ name, value }));

  it('accepts valid names and keeps the values', async () => {
    const { model, deps } = setup();
    const saved = await saveConfig(
      model,
      'g1',
      program({ env: env(['PORT', '4000'], ['_x1', 'a b'], ['EMPTY', '']) }),
      deps,
    );
    expect(saved.env).toEqual(env(['PORT', '4000'], ['_x1', 'a b'], ['EMPTY', '']));
  });

  it('refuses invalid names (empty, with =, with space, starting with a digit)', async () => {
    const { model, deps } = setup();
    for (const name of ['', 'A=B', 'A B', '1A', 'á']) {
      const err = await failure(saveConfig(model, 'g1', program({ name: 'n', env: env([name, 'v']) }), deps));
      expect(err.code, name).toBe('RUN_CONFIG_INVALID');
      expect(err.details?.field, name).toBe('env');
    }
  });

  it('refuses repeated names without regard to case', async () => {
    const { model, deps } = setup();
    const err = await failure(
      saveConfig(model, 'g1', program({ env: env(['Path', '1'], ['PATH', '2']) }), deps),
    );
    expect(err.details?.field).toBe('env');
  });

  it('limits the pairs to 100 and each value to 8,000 characters', async () => {
    const { model, deps } = setup();
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `V${i}`, value: '1' }));
    await expect(saveConfig(model, 'g1', program({ env: many }), deps)).resolves.toBeTruthy();
    const tooMany = [...many, { name: 'V100', value: '1' }];
    expect(
      (await failure(saveConfig(model, 'g1', program({ name: 'b', env: tooMany }), deps))).details?.field,
    ).toBe('env');
    await expect(
      saveConfig(model, 'g1', program({ name: 'c', env: env(['A', 'x'.repeat(8000)]) }), deps),
    ).resolves.toBeTruthy();
    const big = await failure(
      saveConfig(model, 'g1', program({ name: 'd', env: env(['A', 'x'.repeat(8001)]) }), deps),
    );
    expect(big.details?.field).toBe('env');
  });
});

describe('saveConfig — antes de lançar', () => {
  it('refuses a step that does not exist or is itself', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const missing = await failure(
      saveConfig(model, 'g1', program({ name: 'B', beforeLaunch: 'sumiu' }), deps),
    );
    expect(missing.code).toBe('RUN_CONFIG_INVALID');
    expect(missing.details?.field).toBe('beforeLaunch');
    const self = await failure(
      saveConfig(model, 'g1', program({ id: a.id, name: 'A', beforeLaunch: a.id }), deps),
    );
    expect(self.code).toBe('RUN_CONFIG_CYCLE');
  });

  it('refuses a step of another workspace', async () => {
    const state = emptyState();
    state.groups.push(group(), group({ id: 'g2', name: 'Outro' }));
    const core = createFakeCore(state);
    const deps = { fs: core.fs, platform: linux };
    const other = await saveConfig(core.model, 'g2', program({ name: 'Z' }), deps);
    const err = await failure(saveConfig(core.model, 'g1', program({ beforeLaunch: other.id }), deps));
    expect(err.details?.field).toBe('beforeLaunch');
  });

  it('detects cycles A to B to A and a long chain, reporting the chain', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const b = await saveConfig(model, 'g1', program({ name: 'B', beforeLaunch: a.id }), deps);
    const c = await saveConfig(model, 'g1', program({ name: 'C', beforeLaunch: b.id }), deps);
    const direct = await failure(
      saveConfig(model, 'g1', program({ id: a.id, name: 'A', beforeLaunch: b.id }), deps),
    );
    expect(direct.code).toBe('RUN_CONFIG_CYCLE');
    expect(direct.details?.chain).toBe('A → B → A');
    const long = await failure(
      saveConfig(model, 'g1', program({ id: a.id, name: 'A', beforeLaunch: c.id }), deps),
    );
    expect(long.code).toBe('RUN_CONFIG_CYCLE');
    expect(long.details?.chain).toBe('A → C → B → A');
  });

  it('accepts a valid chain', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    await expect(
      saveConfig(model, 'g1', program({ name: 'B', beforeLaunch: a.id }), deps),
    ).resolves.toMatchObject({ beforeLaunch: a.id });
  });
});

describe('launchPlan', () => {
  const base: RunConfig = {
    id: 'c1',
    name: 'X',
    tool: 'program',
    folder: '/repo',
    script: null,
    program: 'node',
    args: ['a b', '& calc'],
    runtimeOptions: '',
    env: [],
    beforeLaunch: null,
    allowParallel: false,
    folderGroup: null,
    order: 0,
  };

  it('program: the program and the args as they are', async () => {
    const { deps } = setup();
    expect(await launchPlan(base, deps)).toEqual({ program: 'node', args: ['a b', '& calc'] });
  });

  it('npm/pnpm/yarn: run <script> then the args', async () => {
    const { deps } = setup();
    for (const tool of ['npm', 'pnpm', 'yarn'] as const) {
      expect(await launchPlan({ ...base, tool, script: 'start', args: ['--x'] }, deps)).toEqual({
        program: tool,
        args: ['run', 'start', '--x'],
      });
    }
  });

  it('maven/gradle: objectives become a vector (space splits, quotes group), then the args', async () => {
    const { deps } = setup();
    const plan = await launchPlan(
      { ...base, tool: 'maven', script: 'clean install -Dname="meu app" & calc', args: ['-q'] },
      deps,
    );
    expect(plan).toEqual({
      program: 'mvn',
      args: ['clean', 'install', '-Dname=meu app', '&', 'calc', '-q'],
    });
    const gradle = await launchPlan({ ...base, tool: 'gradle', script: 'build "x y"', args: [] }, deps);
    expect(gradle.args).toEqual(['build', 'x y']);
  });

  it('compose: docker compose <args>; docker-compose alone when only the legacy tool exists', async () => {
    const { deps, core } = setup();
    expect(await launchPlan({ ...base, tool: 'compose', args: ['up', '-d'] }, deps)).toEqual({
      program: 'docker',
      args: ['compose', 'up', '-d'],
    });
    await core.fs.rm('/bin/docker');
    core.fs.seed('/bin/docker-compose', 'bin');
    expect(await launchPlan({ ...base, tool: 'compose', args: ['up'] }, deps)).toEqual({
      program: 'docker-compose',
      args: ['up'],
    });
  });
});

describe('removeConfig', () => {
  it('removes it from Group.runConfigs', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program(), deps);
    removeConfig(model, 'g1', a.id, () => 0);
    expect(model.group('g1')?.runConfigs ?? []).toEqual([]);
  });

  it('refuses a live one with RUN_CONFIG_RUNNING', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program(), deps);
    const err = await failure(() => removeConfig(model, 'g1', a.id, () => 1));
    expect(err.code).toBe('RUN_CONFIG_RUNNING');
    expect(model.group('g1')?.runConfigs).toHaveLength(1);
  });

  it('reports RUN_CONFIG_MISSING for an unknown id', async () => {
    const { model } = setup();
    const err = await failure(() => removeConfig(model, 'g1', 'sumiu', () => 0));
    expect(err.code).toBe('RUN_CONFIG_MISSING');
  });
});

describe('reorder', () => {
  it('applies folderGroup and order to the listed configs only', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const b = await saveConfig(model, 'g1', program({ name: 'B' }), deps);
    const c = await saveConfig(model, 'g1', program({ name: 'C' }), deps);
    reorder(model, 'g1', [
      { id: b.id, folderGroup: 'Web', order: 0 },
      { id: a.id, folderGroup: 'Web', order: 1 },
    ]);
    const list = model.group('g1')?.runConfigs ?? [];
    expect(list.find((x) => x.id === a.id)).toMatchObject({ folderGroup: 'Web', order: 1 });
    expect(list.find((x) => x.id === b.id)).toMatchObject({ folderGroup: 'Web', order: 0 });
    expect(list.find((x) => x.id === c.id)).toMatchObject({ folderGroup: null, order: 2 });
  });

  it('refuses an unknown id, a folderGroup over 60 characters and a bad order', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const unknown = await failure(() => reorder(model, 'g1', [{ id: 'x', folderGroup: null, order: 0 }]));
    expect(unknown.code).toBe('RUN_CONFIG_MISSING');
    const long = await failure(() =>
      reorder(model, 'g1', [{ id: a.id, folderGroup: 'x'.repeat(61), order: 0 }]),
    );
    expect(long.code).toBe('RUN_CONFIG_INVALID');
    const negative = await failure(() => reorder(model, 'g1', [{ id: a.id, folderGroup: null, order: -1 }]));
    expect(negative.code).toBe('RUN_CONFIG_INVALID');
  });
});

describe('toView', () => {
  it('is available with the running count', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program(), deps);
    const view = await toView(a, model.group('g1') as Group, [a], deps, 2);
    expect(view).toMatchObject({ groupId: 'g1', available: true, unavailableReason: null, running: 2 });
  });

  it('folder-missing when the folder left the workspace', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ folder: '/repo/api' }), deps);
    const without = group({ folders: [{ id: 'f1', path: '/repo' }] });
    expect(await toView(a, without, [a], deps, 0)).toMatchObject({
      available: false,
      unavailableReason: 'folder-missing',
    });
  });

  it('program-missing names what was searched', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ program: 'node' }), deps);
    const view = await toView({ ...a, program: 'nada' }, model.group('g1') as Group, [a], deps, 0);
    expect(view).toMatchObject({ available: false, unavailableReason: 'program-missing', searched: 'nada' });
  });

  it('script-missing when the script left package.json', async () => {
    const { model, deps, core } = setup();
    const a = await saveConfig(model, 'g1', npm(), deps);
    core.fs.seed('/repo/package.json', JSON.stringify({ scripts: { build: 'tsc' } }));
    expect(await toView(a, model.group('g1') as Group, [a], deps, 0)).toMatchObject({
      available: false,
      unavailableReason: 'script-missing',
    });
  });

  it('before-launch-missing when the step was removed', async () => {
    const { model, deps } = setup();
    const a = await saveConfig(model, 'g1', program({ name: 'A' }), deps);
    const b = await saveConfig(model, 'g1', program({ name: 'B', beforeLaunch: a.id }), deps);
    removeConfig(model, 'g1', a.id, () => 0);
    const list = model.group('g1')?.runConfigs ?? [];
    expect(await toView(b, model.group('g1') as Group, list, deps, 0)).toMatchObject({
      available: false,
      unavailableReason: 'before-launch-missing',
    });
  });

  it('unsafe-target when the only target is a .cmd/.bat (never launched with user args)', async () => {
    const { deps, core } = setup(group(), win);
    core.fs.seed('C:\\tools\\mvn.cmd', 'batch');
    core.fs.seed('C:\\tools\\setup.bat', 'batch');
    const base: RunConfig = {
      id: 'c1',
      name: 'M',
      tool: 'maven',
      folder: '/repo',
      script: 'test',
      program: 'mvn',
      args: [],
      runtimeOptions: '',
      env: [],
      beforeLaunch: null,
      allowParallel: false,
      folderGroup: null,
      order: 0,
    };
    const g = group();
    const maven = await toView(base, g, [base], deps, 0);
    expect(maven).toMatchObject({ available: false, unavailableReason: 'unsafe-target' });
    const bat = await toView(
      { ...base, tool: 'program', script: null, program: 'setup' },
      g,
      [base],
      deps,
      0,
    );
    expect(bat).toMatchObject({ available: false, unavailableReason: 'unsafe-target' });
  });
});
