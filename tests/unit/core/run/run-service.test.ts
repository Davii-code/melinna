import { describe, expect, it, vi } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { RunService } from '../../../../src/core/run/run-service';
import type {
  RunConfigInput,
  RunConfigView,
  RunNeedsConfirm,
  RunStarted,
} from '../../../../src/core/run/types';
import { createFakeCore, type FakeCore } from '../../../support/fake-core';
import { fakePlatform } from '../../../support/fakes/platform';

const SIZE = { cols: 100, rows: 30 };
const platform = fakePlatform('linux', '/bin');

interface Rig {
  core: FakeCore;
  run: RunService;
}

function setup(): Rig {
  const state = emptyState();
  state.groups.push(
    {
      id: 'g1',
      name: 'App',
      order: 0,
      folders: [
        { id: 'f1', path: '/repo' },
        { id: 'f2', path: '/repo/api' },
      ],
      primaryFolderId: 'f1',
      repoPath: '/repo',
    },
    {
      id: 'g2',
      name: 'Outro',
      order: 1,
      folders: [{ id: 'f3', path: '/other' }],
      primaryFolderId: 'f3',
      repoPath: '/other',
    },
  );
  const core = createFakeCore(state);
  for (const bin of ['npm', 'node', 'sh', 'mvn', 'echo']) core.fs.seed(`/bin/${bin}`, 'bin');
  core.fs.seed('/repo/package.json', JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }));
  core.fs.seed('/other/package.json', JSON.stringify({ scripts: { start: 'node .' } }));
  core.fs.seed('/repo/api/README.md', '');
  return { core, run: new RunService({ executions: core.executions, platform }) };
}

const config = (over: Partial<RunConfigInput> = {}): RunConfigInput => ({
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

const npm = (script: string, over: Partial<RunConfigInput> = {}) =>
  config({ name: script, tool: 'npm', script, program: '', args: [], ...over });

function started(r: RunStarted | RunNeedsConfirm): RunStarted {
  if ('needsConfirm' in r) throw new Error('pediu confirmação');
  return r;
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('RunService.list', () => {
  it('lists the saved configs of every workspace apart from the detected scripts', async () => {
    const { run } = setup();
    await run.saveConfig('g1', config());
    await run.saveConfig('g2', config({ name: 'Outro servidor', folder: '/other' }));
    const { configs, detected, warnings } = await run.list();
    expect(configs.map((c) => [c.groupId, c.name])).toEqual([
      ['g1', 'Servidor'],
      ['g2', 'Outro servidor'],
    ]);
    expect(detected.map((c) => [c.groupId, c.label])).toEqual([
      ['g1', 'dev'],
      ['g1', 'test'],
      ['g2', 'start'],
    ]);
    expect(warnings).toEqual([]);
  });

  it('lists nothing as saved before the user creates a config, even with detected scripts', async () => {
    const { run } = setup();
    const { configs, detected } = await run.list();
    expect(configs).toEqual([]);
    expect(detected.length).toBeGreaterThan(0);
  });

  it('reports detection warnings with the workspace id', async () => {
    const { core, run } = setup();
    core.fs.seed('/repo/api/package.json', '{ "scripts":');
    const { warnings } = await run.list();
    expect(warnings).toEqual([
      { groupId: 'g1', folder: '/repo/api', message: 'package.json inválido; ignorado.' },
    ]);
  });

  it('computes availability and the number of live instances', async () => {
    const { run } = setup();
    const saved = await run.saveConfig('g1', config());
    started(await run.start('g1', saved.id, SIZE));
    const view = (await run.list()).configs.find((c) => c.id === saved.id) as RunConfigView;
    expect(view).toMatchObject({ available: true, unavailableReason: null, running: 1 });
  });
});

describe('RunService.start', () => {
  it('launches a saved npm config by id on the server, without a shell', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', npm('dev'));
    const r = started(await run.start('g1', saved.id, SIZE));
    expect(r.reused).toBe(false);
    expect(core.host.spawns).toHaveLength(1);
    expect(core.host.spawns[0]).toMatchObject({
      execId: r.execId,
      file: '/bin/npm',
      args: ['run', 'dev'],
      cwd: '/repo',
      cols: 100,
      rows: 30,
    });
  });

  it('keeps each argument as one item', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig(
      'g1',
      config({ args: ['-e', "console.log('oi mundo')", '; rm -rf $(x)'] }),
    );
    started(await run.start('g1', saved.id, SIZE));
    expect(core.host.spawns[0]).toMatchObject({
      file: '/bin/node',
      args: ['-e', "console.log('oi mundo')", '; rm -rf $(x)'],
    });
  });

  it('turns a script name with shell characters into one argv item', async () => {
    const { core, run } = setup();
    core.fs.seed('/repo/package.json', JSON.stringify({ scripts: { 'a; b & $(c) d': 'x' } }));
    const saved = await run.saveConfig('g1', npm('a; b & $(c) d'));
    started(await run.start('g1', saved.id, SIZE));
    expect(core.host.spawns[0]?.args).toEqual(['run', 'a; b & $(c) d']);
  });

  it('splits maven objectives into a vector (space splits, quotes group)', async () => {
    const { core, run } = setup();
    core.fs.seed('/repo/pom.xml', '<project/>');
    const saved = await run.saveConfig(
      'g1',
      config({ name: 'M', tool: 'maven', script: 'clean install -Dname="meu app" & calc', program: '' }),
    );
    started(await run.start('g1', saved.id, SIZE));
    expect(core.host.spawns[0]).toMatchObject({
      file: '/bin/mvn',
      args: ['clean', 'install', '-Dname=meu app', '&', 'calc'],
    });
  });

  it('creates a command task and execution when nothing ran before', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', npm('dev'));
    const r = started(await run.start('g1', saved.id, SIZE));
    expect(core.model.task(r.taskId)).toMatchObject({
      groupId: 'g1',
      kind: 'command',
      isolation: 'direct',
      repoPath: '/repo',
      title: 'dev',
    });
    expect(core.model.execution(r.execId)).toMatchObject({
      taskId: r.taskId,
      agentId: 'command',
      status: 'running',
      worktreePath: '/repo',
      branch: '',
      command: { commandId: saved.id, label: 'dev', file: '/bin/npm', args: ['run', 'dev'] },
    });
  });

  it('runs in the folder of the config, even when it is not the main one', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ folder: '/repo/api' }));
    started(await run.start('g1', saved.id, SIZE));
    expect(core.host.spawns[0]?.cwd).toBe('/repo/api');
  });

  it('fails with COMMAND_STALE for an id that does not exist', async () => {
    const { run } = setup();
    const err = await failure(run.start('g1', 'nao-existe', SIZE));
    expect(err.code).toBe('COMMAND_STALE');
    expect(err.userMessage).toBe('A configuração mudou; abra o seletor de novo.');
  });

  it('does not find a config of another workspace', async () => {
    const { run } = setup();
    const saved = await run.saveConfig('g1', config());
    expect((await failure(run.start('g2', saved.id, SIZE))).code).toBe('COMMAND_STALE');
  });

  it('returns the live execution with reused=true', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', npm('dev'));
    const first = started(await run.start('g1', saved.id, SIZE));
    const second = started(await run.start('g1', saved.id, SIZE));
    expect(second).toEqual({ ...first, reused: true });
    expect(core.host.spawns).toHaveLength(1);
    expect(core.model.raw.executions).toHaveLength(1);
  });

  it('relaunches the same execution when the previous one ended, resolving the program again', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config());
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 0);
    await run.saveConfig('g1', config({ id: saved.id, args: ['outro.js'] }));
    const second = started(await run.start('g1', saved.id, SIZE));
    expect(second).toEqual({ taskId: first.taskId, execId: first.execId, reused: false });
    expect(core.host.spawns).toHaveLength(2);
    expect(core.host.spawns[1]).toMatchObject({ execId: first.execId, args: ['outro.js'] });
    expect(core.model.execution(first.execId)).toMatchObject({
      launchCount: 2,
      status: 'running',
      command: { args: ['outro.js'] },
    });
    expect(core.model.raw.tasks).toHaveLength(1);
  });

  it('fails with PROGRAM_NOT_FOUND when the program is gone', async () => {
    const { run } = setup();
    const saved = await run.saveConfig('g1', config({ program: 'sumiu' }));
    const err = await failure(run.start('g1', saved.id, SIZE));
    expect(err.code).toBe('PROGRAM_NOT_FOUND');
    expect(err.userMessage).toBe('Programa não encontrado: sumiu.');
  });

  it('refuses a config whose folder left the workspace', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ folder: '/repo/api' }));
    core.model.mutate((s) => {
      const g = s.groups.find((x) => x.id === 'g1');
      if (g) g.folders = [{ id: 'f1', path: '/repo' }];
    });
    const err = await failure(run.start('g1', saved.id, SIZE));
    expect(err.code).toBe('INPUT_INVALID');
    expect(err.userMessage).toBe('A pasta precisa ser do workspace.');
  });

  it('respects the live terminal limit', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config());
    for (let i = 0; i < 12; i++) {
      core.model.mutate((s) => {
        s.executions.push({
          id: `live${i}`,
          taskId: 'tx',
          agentId: 'fake',
          bandIndex: 0,
          model: null,
          permissionMode: null,
          branch: '',
          worktreePath: '/repo',
          baseCommit: '',
          status: 'running',
          pendingSwitch: null,
          pid: i + 1,
          exitCode: null,
          signal: null,
          startedAt: null,
          endedAt: null,
          launchCount: 1,
          failure: null,
        });
      });
    }
    expect((await failure(run.start('g1', saved.id, SIZE))).code).toBe('LIMIT_REACHED');
    expect(core.model.raw.tasks).toHaveLength(0);
  });

  it('two simultaneous starts of the same config create one execution', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', npm('dev'));
    const results = await Promise.all([run.start('g1', saved.id, SIZE), run.start('g1', saved.id, SIZE)]);
    const a = started(results[0]);
    const b = started(results[1]);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(a.execId).toBe(b.execId);
    expect(core.host.spawns).toHaveLength(1);
    expect(core.model.raw.executions).toHaveLength(1);
  });

  it('keeps the failed execution when the spawn fails, so the user sees why', async () => {
    const { core, run } = setup();
    core.host.spawnFailure = () => new MelinnaError('HOST_UNAVAILABLE');
    const saved = await run.saveConfig('g1', npm('dev'));
    await failure(run.start('g1', saved.id, SIZE));
    expect(core.model.raw.executions[0]?.status).toBe('failed_to_start');
  });
});

describe('RunService.start — ambiente', () => {
  it('passes the variables of the config to the process and lets them win over the base', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig(
      'g1',
      config({
        env: [
          { name: 'PORT', value: '4000' },
          { name: 'term', value: 'dumb' },
        ],
      }),
    );
    started(await run.start('g1', saved.id, SIZE));
    const env = core.host.spawns[0]?.env ?? {};
    expect(env.PORT).toBe('4000');
    expect(env.term).toBe('dumb');
    expect(env.TERM).toBeUndefined();
    expect(env.MELINNA_EXECUTION_ID).toBeTruthy();
  });

  it('appends runtimeOptions to NODE_OPTIONS, MAVEN_OPTS and GRADLE_OPTS of each tool', async () => {
    const { core, run } = setup();
    core.fs.seed('/repo/pom.xml', '<project/>');
    core.fs.seed('/bin/gradle', 'bin');
    const node = await run.saveConfig('g1', npm('dev', { runtimeOptions: '--inspect' }));
    const maven = await run.saveConfig(
      'g1',
      config({ name: 'M', tool: 'maven', script: 'test', program: '', runtimeOptions: '-Xmx1g' }),
    );
    const gradle = await run.saveConfig(
      'g1',
      config({ name: 'G', tool: 'gradle', script: 'build', program: '', runtimeOptions: '-Xmx2g' }),
    );
    for (const c of [node, maven, gradle]) started(await run.start('g1', c.id, SIZE));
    expect(core.host.spawns[0]?.env.NODE_OPTIONS).toBe('--inspect');
    expect(core.host.spawns[1]?.env.MAVEN_OPTS).toBe('-Xmx1g');
    expect(core.host.spawns[2]?.env.GRADLE_OPTS).toBe('-Xmx2g');
  });

  it('keeps the variables on a relaunch of the same execution', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ env: [{ name: 'PORT', value: '4000' }] }));
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 0);
    await core.executions.relaunch(first.execId, SIZE);
    expect(core.host.spawns[1]?.env.PORT).toBe('4000');
  });
});

describe('RunService.start — antes de lançar', () => {
  /** Salva a etapa e a principal que depende dela. */
  async function chain(
    rig: Rig,
    stepOver: Partial<RunConfigInput> = {},
    mainOver: Partial<RunConfigInput> = {},
  ) {
    const step = await rig.run.saveConfig('g1', config({ name: 'Build', args: ['build.js'], ...stepOver }));
    const main = await rig.run.saveConfig(
      'g1',
      config({ name: 'Servidor', args: ['server.js'], beforeLaunch: step.id, ...mainOver }),
    );
    return { step, main };
  }

  it('runs the step as a visible execution, waits for it and launches the main config only on exit 0', async () => {
    const rig = setup();
    const { step, main } = await chain(rig);
    const pending = rig.run.start('g1', main.id, SIZE);
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    expect(rig.core.host.spawns[0]).toMatchObject({ args: ['build.js'] });
    const stepExec = rig.core.model.raw.executions.find((e) => e.command?.commandId === step.id);
    expect(stepExec).toMatchObject({ status: 'running' });
    // enquanto a etapa roda, a principal não é lançada
    await Promise.resolve();
    expect(rig.core.host.spawns).toHaveLength(1);
    rig.core.host.exit(stepExec?.id ?? '', 0);
    const r = started(await pending);
    expect(rig.core.host.spawns).toHaveLength(2);
    expect(rig.core.host.spawns[1]).toMatchObject({ execId: r.execId, args: ['server.js'] });
    expect(rig.core.model.execution(r.execId)?.command?.commandId).toBe(main.id);
  });

  it('runs a longer chain from the farthest step to the config', async () => {
    const rig = setup();
    const a = await rig.run.saveConfig('g1', config({ name: 'A', args: ['a.js'] }));
    const b = await rig.run.saveConfig('g1', config({ name: 'B', args: ['b.js'], beforeLaunch: a.id }));
    const c = await rig.run.saveConfig('g1', config({ name: 'C', args: ['c.js'], beforeLaunch: b.id }));
    const pending = rig.run.start('g1', c.id, SIZE);
    for (const [i, script] of ['a.js', 'b.js'].entries()) {
      await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(i + 1));
      expect(rig.core.host.spawns[i]?.args).toEqual([script]);
      rig.core.host.exit(rig.core.host.spawns[i]?.execId ?? '', 0);
    }
    started(await pending);
    expect(rig.core.host.spawns.map((s) => s.args[0])).toEqual(['a.js', 'b.js', 'c.js']);
  });

  it('fails with RUN_BEFORE_LAUNCH_FAILED and the exit code when the step exits with a code other than 0', async () => {
    const rig = setup();
    const { main } = await chain(rig);
    const pending = rig.run.start('g1', main.id, SIZE);
    const assertion = failure(pending);
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    rig.core.host.exit(rig.core.host.spawns[0]?.execId ?? '', 1);
    const err = await assertion;
    expect(err.code).toBe('RUN_BEFORE_LAUNCH_FAILED');
    expect(err.details).toMatchObject({ name: 'Build', reason: 'exit', exitCode: 1 });
    expect(err.userMessage).toContain('Build');
    expect(rig.core.host.spawns).toHaveLength(1);
    expect(rig.core.model.raw.executions.some((e) => e.command?.label === 'Servidor')).toBe(false);
  });

  it('fails as cancelled when the step is stopped by the user, even with exit code 0', async () => {
    const rig = setup();
    const { main } = await chain(rig);
    const pending = rig.run.start('g1', main.id, SIZE);
    const assertion = failure(pending);
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    await rig.core.executions.stop(rig.core.host.spawns[0]?.execId ?? '');
    const err = await assertion;
    expect(err.code).toBe('RUN_BEFORE_LAUNCH_FAILED');
    expect(err.details).toMatchObject({ name: 'Build', reason: 'cancelled' });
    expect(rig.core.host.spawns).toHaveLength(1);
  });

  it('fails as cancelled when the step dies by a signal', async () => {
    const rig = setup();
    const { main } = await chain(rig);
    const assertion = failure(rig.run.start('g1', main.id, SIZE));
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    rig.core.host.exit(rig.core.host.spawns[0]?.execId ?? '', null, 'SIGTERM');
    expect((await assertion).details).toMatchObject({ reason: 'cancelled' });
  });

  it('fails with already-running when the step is alive and does not allow several instances', async () => {
    const rig = setup();
    const { step, main } = await chain(rig);
    started(await rig.run.start('g1', step.id, SIZE));
    const err = await failure(rig.run.start('g1', main.id, SIZE));
    expect(err.code).toBe('RUN_BEFORE_LAUNCH_FAILED');
    expect(err.details).toMatchObject({ name: 'Build', reason: 'already-running' });
    expect(rig.core.host.spawns).toHaveLength(1);
  });

  it('lets a step that allows several instances run again while another instance is alive', async () => {
    const rig = setup();
    const { step, main } = await chain(rig, { allowParallel: true });
    started(await rig.run.start('g1', step.id, SIZE));
    const pending = rig.run.start('g1', main.id, SIZE);
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(2));
    expect(rig.core.host.spawns[1]?.execId).not.toBe(rig.core.host.spawns[0]?.execId);
    rig.core.host.exit(rig.core.host.spawns[1]?.execId ?? '', 0);
    started(await pending);
    expect(rig.core.host.spawns).toHaveLength(3);
  });

  it('refuses to start when the step was removed, launching nothing', async () => {
    const rig = setup();
    const { step, main } = await chain(rig);
    rig.core.model.mutate((s) => {
      const g = s.groups.find((x) => x.id === 'g1');
      if (g) g.runConfigs = (g.runConfigs ?? []).filter((c) => c.id !== step.id);
    });
    const err = await failure(rig.run.start('g1', main.id, SIZE));
    expect(err.code).toBe('RUN_CONFIG_INVALID');
    expect(err.details).toMatchObject({ field: 'beforeLaunch' });
    expect(rig.core.host.spawns).toHaveLength(0);
  });

  it('returns the live main execution on a second start without running the steps again', async () => {
    const rig = setup();
    const { step, main } = await chain(rig);
    const pending = rig.run.start('g1', main.id, SIZE);
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    rig.core.host.exit(rig.core.host.spawns[0]?.execId ?? '', 0);
    const first = started(await pending);
    const again = started(await rig.run.start('g1', main.id, SIZE));
    expect(again).toEqual({ ...first, reused: true });
    expect(rig.core.host.spawns).toHaveLength(2);
    expect(rig.core.model.raw.executions.filter((e) => e.command?.commandId === step.id)).toHaveLength(1);
  });

  it('asks for the wrapper confirmation of a step before any step runs, and a refusal runs nothing', async () => {
    const rig = setup();
    rig.core.fs.seed('/repo/pom.xml', '<project/>');
    rig.core.fs.seed('/repo/mvnw', '#!/bin/sh');
    rig.core.fs.setMode('/repo/mvnw', 0o644);
    const step = await rig.run.saveConfig(
      'g1',
      config({ name: 'Compilar', tool: 'maven', script: 'compile', program: '' }),
    );
    const main = await rig.run.saveConfig('g1', config({ name: 'Servidor', beforeLaunch: step.id }));
    expect(await rig.run.start('g1', main.id, SIZE)).toEqual({
      needsConfirm: 'wrapper-sh',
      wrapper: '/repo/mvnw',
    });
    expect(rig.core.host.spawns).toHaveLength(0);
    expect(rig.core.model.raw.tasks).toHaveLength(0);
    const pending = rig.run.start('g1', main.id, SIZE, 'wrapper-sh');
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    expect(rig.core.host.spawns[0]).toMatchObject({ file: '/bin/sh', args: ['/repo/mvnw', 'compile'] });
    rig.core.host.exit(rig.core.host.spawns[0]?.execId ?? '', 0);
    started(await pending);
  });
});

describe('RunService.start — várias instâncias', () => {
  it('creates another execution at each start when allowParallel is on', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ allowParallel: true }));
    const first = started(await run.start('g1', saved.id, SIZE));
    const second = started(await run.start('g1', saved.id, SIZE));
    expect(second.reused).toBe(false);
    expect(second.execId).not.toBe(first.execId);
    expect(second.taskId).not.toBe(first.taskId);
    expect(core.host.spawns).toHaveLength(2);
    const view = (await run.list()).configs.find((c) => c.id === saved.id);
    expect(view?.running).toBe(2);
  });

  it('still respects the limit of 12 live executions', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ allowParallel: true }));
    for (let i = 0; i < 12; i++) started(await run.start('g1', saved.id, SIZE));
    expect((await failure(run.start('g1', saved.id, SIZE))).code).toBe('LIMIT_REACHED');
    expect(core.host.spawns).toHaveLength(12);
  });

  it('refuses to remove a config while any instance is alive', async () => {
    const { run } = setup();
    const saved = await run.saveConfig('g1', config({ allowParallel: true }));
    started(await run.start('g1', saved.id, SIZE));
    started(await run.start('g1', saved.id, SIZE));
    expect((await failure(run.removeConfig('g1', saved.id))).code).toBe('RUN_CONFIG_RUNNING');
  });
});

describe('RunService.start — wrapper without the execute bit', () => {
  async function wrapperSetup() {
    const rig = setup();
    rig.core.fs.seed('/repo/pom.xml', '<project/>');
    rig.core.fs.seed('/repo/mvnw', '#!/bin/sh');
    rig.core.fs.setMode('/repo/mvnw', 0o644);
    const compile = await rig.run.saveConfig(
      'g1',
      config({ name: 'Maven: compile', tool: 'maven', script: 'compile', program: '' }),
    );
    return { ...rig, compile };
  }

  it('asks for confirmation before launching and launches nothing', async () => {
    const { core, run, compile } = await wrapperSetup();
    expect(await run.start('g1', compile.id, SIZE)).toEqual({
      needsConfirm: 'wrapper-sh',
      wrapper: '/repo/mvnw',
    });
    expect(core.host.spawns).toHaveLength(0);
    expect(core.model.raw.tasks).toHaveLength(0);
  });

  it('wrapper-sh runs "sh <wrapper> <args>" without -c', async () => {
    const { core, run, compile } = await wrapperSetup();
    started(await run.start('g1', compile.id, SIZE, 'wrapper-sh'));
    expect(core.host.spawns[0]).toMatchObject({ file: '/bin/sh', args: ['/repo/mvnw', 'compile'] });
    expect(core.host.spawns[0]?.args).not.toContain('-c');
  });

  it('system-tool runs mvn from the system', async () => {
    const { core, run, compile } = await wrapperSetup();
    started(await run.start('g1', compile.id, SIZE, 'system-tool'));
    expect(core.host.spawns[0]).toMatchObject({ file: '/bin/mvn', args: ['compile'] });
  });

  it('refuses a choice when the config does not use that kind of wrapper', async () => {
    const { run } = setup();
    const dev = await run.saveConfig('g1', npm('dev'));
    expect((await failure(run.start('g1', dev.id, SIZE, 'wrapper-sh'))).code).toBe('INPUT_INVALID');
    expect((await failure(run.start('g1', dev.id, SIZE, 'system-tool'))).code).toBe('INPUT_INVALID');
  });

  it('refuses a choice once the wrapper has the execute bit', async () => {
    const { core, run, compile } = await wrapperSetup();
    core.fs.setMode('/repo/mvnw', 0o755);
    expect((await failure(run.start('g1', compile.id, SIZE, 'wrapper-sh'))).code).toBe('INPUT_INVALID');
    started(await run.start('g1', compile.id, SIZE));
    expect(core.host.spawns[0]).toMatchObject({ file: '/repo/mvnw', args: ['compile'] });
  });
});

describe('RunService.rerun', () => {
  it('stops a live execution and relaunches it with a separator in the history', async () => {
    const { core, run } = setup();
    const dev = await run.saveConfig('g1', npm('dev'));
    const first = started(await run.start('g1', dev.id, SIZE));
    await run.rerun(first.execId, SIZE);
    expect(core.host.kills).toEqual([first.execId]);
    expect(core.host.spawns).toHaveLength(2);
    expect(core.host.spawns[1]).toMatchObject({ execId: first.execId });
    expect(core.host.spawns[1]?.separator).toMatch(/relançado em/);
    expect(core.model.execution(first.execId)?.status).toBe('running');
  });

  it('relaunches an ended execution without stopping anything', async () => {
    const { core, run } = setup();
    const dev = await run.saveConfig('g1', npm('dev'));
    const first = started(await run.start('g1', dev.id, SIZE));
    core.host.exit(first.execId, 1);
    await run.rerun(first.execId, SIZE);
    expect(core.host.kills).toEqual([]);
    expect(core.host.spawns).toHaveLength(2);
  });

  it('resolves the config again, with its current environment, and updates the stored command', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ env: [{ name: 'PORT', value: '4000' }] }));
    const first = started(await run.start('g1', saved.id, SIZE));
    await run.saveConfig(
      'g1',
      config({ id: saved.id, args: ['b.js'], name: 'Renomeado', env: [{ name: 'PORT', value: '5000' }] }),
    );
    await run.rerun(first.execId, SIZE);
    expect(core.host.spawns[1]?.args).toEqual(['b.js']);
    expect(core.host.spawns[1]?.env.PORT).toBe('5000');
    expect(core.model.execution(first.execId)?.command).toMatchObject({ label: 'Renomeado', args: ['b.js'] });
  });

  it('does not run the steps of "antes de lançar" again', async () => {
    const rig = setup();
    const step = await rig.run.saveConfig('g1', config({ name: 'Build', args: ['build.js'] }));
    const main = await rig.run.saveConfig(
      'g1',
      config({ name: 'Servidor', args: ['server.js'], beforeLaunch: step.id }),
    );
    const pending = rig.run.start('g1', main.id, SIZE);
    await vi.waitFor(() => expect(rig.core.host.spawns).toHaveLength(1));
    rig.core.host.exit(rig.core.host.spawns[0]?.execId ?? '', 0);
    const r = started(await pending);
    await rig.run.rerun(r.execId, SIZE);
    expect(rig.core.host.spawns.map((s) => s.args[0])).toEqual(['build.js', 'server.js', 'server.js']);
  });

  it('fails with RUN_CONFIG_MISSING when the config disappeared', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config());
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 0);
    await run.removeConfig('g1', saved.id);
    const err = await failure(run.rerun(first.execId, SIZE));
    expect(err.code).toBe('RUN_CONFIG_MISSING');
    expect(core.host.spawns).toHaveLength(1);
  });

  it('fails with PROGRAM_NOT_FOUND when the program is gone', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config({ program: 'sumiu' }));
    core.fs.seed('/bin/sumiu', 'bin');
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 0);
    await core.fs.rm('/bin/sumiu');
    expect((await failure(run.rerun(first.execId, SIZE))).code).toBe('PROGRAM_NOT_FOUND');
  });

  it('refuses an execution that is not a command', async () => {
    const { core, run } = setup();
    const g = core.model.group('g1');
    const task = await core.workspace.createTask({
      groupId: g?.id ?? '',
      repoPath: '/repo',
      baseRef: 'main',
      prompt: '',
    });
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake' }], SIZE);
    expect((await failure(run.rerun(r?.execId ?? '', SIZE))).code).toBe('INPUT_INVALID');
  });
});

describe('RunService.saveConfig, removeConfig and reorder', () => {
  it('saves and returns the config with its availability', async () => {
    const { run } = setup();
    const saved = await run.saveConfig('g1', config());
    expect(saved).toMatchObject({
      groupId: 'g1',
      tool: 'program',
      name: 'Servidor',
      available: true,
      running: 0,
    });
  });

  it('removes a config', async () => {
    const { run } = setup();
    const saved = await run.saveConfig('g1', config());
    await run.removeConfig('g1', saved.id);
    expect((await run.list()).configs.some((c) => c.id === saved.id)).toBe(false);
  });

  it('refuses to remove a config while its execution is alive', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config());
    started(await run.start('g1', saved.id, SIZE));
    const err = await failure(run.removeConfig('g1', saved.id));
    expect(err.code).toBe('RUN_CONFIG_RUNNING');
    expect(core.model.group('g1')?.runConfigs).toHaveLength(1);
  });

  it('reorders', async () => {
    const { run } = setup();
    const a = await run.saveConfig('g1', config({ name: 'A' }));
    const b = await run.saveConfig('g1', config({ name: 'B' }));
    await run.reorder('g1', [
      { id: b.id, folderGroup: 'Web', order: 0 },
      { id: a.id, folderGroup: 'Web', order: 1 },
    ]);
    const list = (await run.list()).configs;
    expect(list.map((c) => [c.name, c.folderGroup, c.order])).toEqual([
      ['A', 'Web', 1],
      ['B', 'Web', 0],
    ]);
  });
});

describe('RunService logs', () => {
  it('logs the lifecycle with the variable names only, never values, arguments, programs or paths', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig(
      'g1',
      config({
        args: ['--segredo=abc'],
        env: [
          { name: 'API_TOKEN', value: 'valor-secreto' },
          { name: 'PORT', value: '4000' },
        ],
        runtimeOptions: '',
      }),
    );
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 3);
    await run.removeConfig('g1', saved.id);
    const events = core.log.records.filter((r) => r.event.startsWith('run.'));
    expect(events.map((e) => e.event)).toEqual([
      'run.config.save',
      'run.start',
      'run.stopped',
      'run.config.remove',
    ]);
    expect(events[0]?.fields).toEqual({
      groupId: 'g1',
      configId: saved.id,
      tool: 'program',
      envCount: 2,
      created: true,
    });
    expect(events[1]?.fields).toEqual({
      configId: saved.id,
      tool: 'program',
      envNames: 'API_TOKEN,PORT',
      parallel: false,
      beforeLaunch: 0,
    });
    expect(events[2]?.fields).toEqual({ groupId: 'g1', exitCode: 3 });
    expect(events[3]?.fields).toEqual({ groupId: 'g1' });
    expect(core.log.text()).not.toContain('valor-secreto');
    const text = JSON.stringify(events);
    expect(text).not.toContain('segredo');
    expect(text).not.toContain('4000');
    expect(text).not.toContain('node');
    expect(text).not.toContain('/repo');
  });

  it('logs the reuse of a live execution', async () => {
    const { core, run } = setup();
    const saved = await run.saveConfig('g1', config());
    started(await run.start('g1', saved.id, SIZE));
    started(await run.start('g1', saved.id, SIZE));
    expect(core.log.events().filter((e) => e === 'run.reused')).toHaveLength(1);
  });
});
