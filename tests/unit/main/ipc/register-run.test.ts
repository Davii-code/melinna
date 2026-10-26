import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { RunService } from '../../../../src/core/run/run-service';
import { registerRun } from '../../../../src/main/ipc/register-run';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';
import { fakePlatform } from '../../../support/fakes/platform';

const SIZE = { cols: 80, rows: 24 };

function setup() {
  const state = emptyState();
  state.groups.push({
    id: 'g1',
    name: 'App',
    order: 0,
    folders: [{ id: 'f1', path: '/repo' }],
    primaryFolderId: 'f1',
    repoPath: '/repo',
  });
  const core = createFakeCore(state);
  for (const bin of ['npm', 'node']) core.fs.seed(`/bin/${bin}`, 'bin');
  core.fs.seed('/repo/package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
  const run = new RunService({ executions: core.executions, platform: fakePlatform('linux', '/bin') });
  const rec = handleRecorder();
  registerRun(rec.handle, { run, model: core.model, log: core.log });
  return { core, rec };
}

const input = (over: Record<string, unknown> = {}) => ({
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

type Listing = {
  configs: { id: string; name: string; groupId: string }[];
  detected: { label: string; groupId: string }[];
  warnings: unknown[];
};

describe('run IPC', () => {
  it('registers the run channels', () => {
    expect(setup().rec.channels()).toEqual([
      'run:list',
      'run:removeConfig',
      'run:reorder',
      'run:rerun',
      'run:saveConfig',
      'run:start',
    ]);
  });

  it('lists the saved configs and the detected scripts apart', async () => {
    const { rec } = setup();
    const empty = (await rec.call('run:list')).value as Listing;
    expect(empty.configs).toEqual([]);
    expect(empty.detected.map((c) => [c.groupId, c.label])).toEqual([['g1', 'dev']]);
    expect(empty.warnings).toEqual([]);
    await rec.call('run:saveConfig', 'g1', input());
    const listing = (await rec.call('run:list')).value as Listing;
    expect(listing.configs.map((c) => [c.groupId, c.name])).toEqual([['g1', 'Servidor']]);
    expect(listing.detected).toHaveLength(1);
  });

  it('refuses arguments on list', async () => {
    expect((await setup().rec.call('run:list', 'x')).error?.code).toBe('INPUT_INVALID');
  });

  it('starts a saved config by id and reports reuse on the second start', async () => {
    const { rec, core } = setup();
    const saved = await rec.call('run:saveConfig', 'g1', input());
    const id = (saved.value as { id: string }).id;
    const first = await rec.call('run:start', 'g1', id, SIZE);
    expect(first).toMatchObject({ ok: true, value: { reused: false } });
    expect(core.host.spawns[0]).toMatchObject({ file: '/bin/node', args: ['server.js'], cols: 80, rows: 24 });
    const second = await rec.call('run:start', 'g1', id, SIZE);
    expect(second).toMatchObject({ ok: true, value: { reused: true } });
  });

  it('maps COMMAND_STALE with the contract message', async () => {
    const { rec } = setup();
    const r = await rec.call('run:start', 'g1', 'nao-existe', SIZE);
    expect(r.error).toEqual({
      code: 'COMMAND_STALE',
      message: 'A configuração mudou; abra o seletor de novo.',
    });
  });

  it('validates start: workspace, id format, size and choice', async () => {
    const { rec } = setup();
    const code = async (...args: unknown[]) => (await rec.call('run:start', ...args)).error?.code;
    expect(await code('nao-existe', 'abc', SIZE)).toBe('INPUT_INVALID');
    expect(await code('g1', 'id com espaço', SIZE)).toBe('INPUT_INVALID');
    expect(await code('g1', 42, SIZE)).toBe('INPUT_INVALID');
    expect(await code('g1', 'abc', { cols: 5, rows: 5 })).toBe('INPUT_INVALID');
    expect(await code('g1', 'abc', SIZE, 'sh-c')).toBe('INPUT_INVALID');
  });

  it('saves, edits and removes a config', async () => {
    const { rec, core } = setup();
    const saved = await rec.call('run:saveConfig', 'g1', input());
    expect(saved).toMatchObject({
      ok: true,
      value: { name: 'Servidor', tool: 'program', available: true, running: 0, groupId: 'g1' },
    });
    const id = (saved.value as { id: string }).id;
    const edited = await rec.call('run:saveConfig', 'g1', input({ id, name: 'Novo' }));
    expect(edited).toMatchObject({ ok: true, value: { id, name: 'Novo' } });
    expect(await rec.call('run:removeConfig', 'g1', id)).toEqual({ ok: true, value: undefined });
    expect(core.model.group('g1')?.runConfigs ?? []).toEqual([]);
  });

  it('saves a config from a detected npm script with environment and runtime options', async () => {
    const { rec } = setup();
    const saved = await rec.call(
      'run:saveConfig',
      'g1',
      input({
        name: 'dev',
        tool: 'npm',
        script: 'dev',
        program: '',
        args: [],
        runtimeOptions: '--inspect',
        env: [{ name: 'PORT', value: '4000' }],
      }),
    );
    expect(saved).toMatchObject({
      ok: true,
      value: { tool: 'npm', script: 'dev', program: 'npm', runtimeOptions: '--inspect' },
    });
  });

  it('validates saveConfig', async () => {
    const { rec } = setup();
    const code = async (groupId: unknown, v: unknown) =>
      (await rec.call('run:saveConfig', groupId, v)).error?.code;
    expect(await code('g1', null)).toBe('INPUT_INVALID');
    expect(await code('nao-existe', input())).toBe('INPUT_INVALID');
    expect(await code('g1', input({ name: '' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ name: 'x'.repeat(81) }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ tool: 'bash' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ program: 7 }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: 'a b' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: [1] }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: Array.from({ length: 65 }, () => 'a') }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: ['x'.repeat(4097)] }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ folder: '' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ id: 'id com espaço' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ env: 'PORT=1' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ env: [{ name: 'A' }] }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ env: [{ name: 'A', value: 'x'.repeat(8001) }] }))).toBe('INPUT_INVALID');
    expect(
      await code('g1', input({ env: Array.from({ length: 101 }, (_, i) => ({ name: `V${i}`, value: '' })) })),
    ).toBe('INPUT_INVALID');
    expect(await code('g1', input({ runtimeOptions: 'x'.repeat(1001) }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ beforeLaunch: 'id com espaço' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ allowParallel: 'sim' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ folderGroup: 5 }))).toBe('INPUT_INVALID');
  });

  it('reports a duplicate name, a folder outside, a bad variable name and a cycle with pt-BR messages', async () => {
    const { rec } = setup();
    const first = await rec.call('run:saveConfig', 'g1', input());
    expect((await rec.call('run:saveConfig', 'g1', input())).error).toMatchObject({
      code: 'RUN_CONFIG_INVALID',
      message: 'Já existe uma configuração com esse nome.',
    });
    const outside = await rec.call('run:saveConfig', 'g1', input({ name: 'Z', folder: '/fora' }));
    expect(outside.error?.message).toBe('A pasta precisa ser do workspace.');
    const badEnv = await rec.call(
      'run:saveConfig',
      'g1',
      input({ name: 'E', env: [{ name: '1A', value: '' }] }),
    );
    expect(badEnv.error?.code).toBe('RUN_CONFIG_INVALID');
    const id = (first.value as { id: string }).id;
    const cycle = await rec.call('run:saveConfig', 'g1', input({ id, beforeLaunch: id }));
    expect(cycle.error?.code).toBe('RUN_CONFIG_CYCLE');
    expect(cycle.error?.message).toContain('Servidor → Servidor');
  });

  it('logs run.config.save with the number of variables and never their values', async () => {
    const { rec, core } = setup();
    await rec.call(
      'run:saveConfig',
      'g1',
      input({ env: [{ name: 'API_TOKEN', value: 'valor-secreto-123' }], runtimeOptions: '' }),
    );
    const record = core.log.records.find((r) => r.event === 'run.config.save');
    expect(record?.fields).toMatchObject({ groupId: 'g1', tool: 'program', envCount: 1, created: true });
    expect(core.log.text()).not.toContain('valor-secreto-123');
  });

  it('refuses to remove a config that is running', async () => {
    const { rec } = setup();
    const saved = await rec.call('run:saveConfig', 'g1', input());
    const id = (saved.value as { id: string }).id;
    await rec.call('run:start', 'g1', id, SIZE);
    const r = await rec.call('run:removeConfig', 'g1', id);
    expect(r.error).toEqual({
      code: 'RUN_CONFIG_RUNNING',
      message: 'A configuração está rodando. Pare-a antes.',
    });
  });

  it('validates removeConfig', async () => {
    const { rec } = setup();
    expect((await rec.call('run:removeConfig', 'nao-existe', 'abc')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('run:removeConfig', 'g1', 'id com espaço')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('run:removeConfig', 'g1', 'abc')).error?.code).toBe('RUN_CONFIG_MISSING');
  });

  it('reorders configs into folder groups', async () => {
    const { rec, core } = setup();
    const a = (await rec.call('run:saveConfig', 'g1', input({ name: 'A' }))).value as { id: string };
    const b = (await rec.call('run:saveConfig', 'g1', input({ name: 'B' }))).value as { id: string };
    const r = await rec.call('run:reorder', 'g1', [
      { id: b.id, folderGroup: 'Web', order: 0 },
      { id: a.id, folderGroup: 'Web', order: 1 },
    ]);
    expect(r).toEqual({ ok: true, value: undefined });
    const list = core.model.group('g1')?.runConfigs ?? [];
    expect(list.map((c) => [c.name, c.folderGroup, c.order])).toEqual([
      ['A', 'Web', 1],
      ['B', 'Web', 0],
    ]);
  });

  it('validates reorder', async () => {
    const { rec } = setup();
    const code = async (groupId: unknown, items: unknown) =>
      (await rec.call('run:reorder', groupId, items)).error?.code;
    expect(await code('nao-existe', [])).toBe('INPUT_INVALID');
    expect(await code('g1', 'x')).toBe('INPUT_INVALID');
    expect(await code('g1', [{ id: 'a', folderGroup: null }])).toBe('INPUT_INVALID');
    expect(await code('g1', [{ id: 'a', folderGroup: null, order: -1 }])).toBe('INPUT_INVALID');
    expect(await code('g1', [{ id: 'a', folderGroup: 'x'.repeat(61), order: 0 }])).toBe('INPUT_INVALID');
    expect(
      await code(
        'g1',
        Array.from({ length: 101 }, (_, i) => ({ id: `a${i}`, folderGroup: null, order: i })),
      ),
    ).toBe('INPUT_INVALID');
  });

  it('reruns an execution of a command and refuses one that is not', async () => {
    const { rec, core } = setup();
    const saved = await rec.call('run:saveConfig', 'g1', input());
    const id = (saved.value as { id: string }).id;
    const started = (await rec.call('run:start', 'g1', id, SIZE)).value as { execId: string };
    expect(await rec.call('run:rerun', started.execId, SIZE)).toEqual({ ok: true, value: undefined });
    expect(core.host.spawns).toHaveLength(2);
    expect((await rec.call('run:rerun', 'nao-existe', SIZE)).error?.code).toBe('INPUT_INVALID');

    const task = await core.workspace.createTask({
      groupId: 'g1',
      repoPath: '/repo',
      baseRef: 'main',
      prompt: '',
    });
    const [agent] = await core.executions.launch(task.id, [{ agentId: 'fake' }], SIZE);
    const notCommand = await rec.call('run:rerun', agent?.execId, SIZE);
    expect(notCommand.error?.code).toBe('INPUT_INVALID');
  });
});

describe('run IPC — lançamento completo', () => {
  it('starts by configId and reports a failing "antes de lançar" step with its name', async () => {
    const { rec, core } = setup();
    const step = (await rec.call('run:saveConfig', 'g1', input({ name: 'Build', args: ['build.js'] })))
      .value as { id: string };
    const main = (await rec.call('run:saveConfig', 'g1', input({ name: 'Servidor', beforeLaunch: step.id })))
      .value as { id: string };
    const pending = rec.call('run:start', 'g1', main.id, SIZE);
    await vi.waitFor(() => expect(core.host.spawns).toHaveLength(1));
    core.host.exit(core.host.spawns[0]?.execId ?? '', 2);
    const r = await pending;
    expect(r.error?.code).toBe('RUN_BEFORE_LAUNCH_FAILED');
    expect(r.error?.message).toContain('Build');
    expect(core.host.spawns).toHaveLength(1);
  });

  it('runs the step and then the config, answering once with the main execution', async () => {
    const { rec, core } = setup();
    const step = (await rec.call('run:saveConfig', 'g1', input({ name: 'Build', args: ['build.js'] })))
      .value as { id: string };
    const main = (await rec.call('run:saveConfig', 'g1', input({ name: 'Servidor', beforeLaunch: step.id })))
      .value as { id: string };
    const pending = rec.call('run:start', 'g1', main.id, SIZE);
    await vi.waitFor(() => expect(core.host.spawns).toHaveLength(1));
    core.host.exit(core.host.spawns[0]?.execId ?? '', 0);
    const r = await pending;
    expect(r).toMatchObject({ ok: true, value: { reused: false } });
    expect(core.host.spawns.map((s) => s.args[0])).toEqual(['build.js', 'server.js']);
  });

  it('answers with a second execution for a config that allows several instances', async () => {
    const { rec } = setup();
    const saved = (await rec.call('run:saveConfig', 'g1', input({ allowParallel: true }))).value as {
      id: string;
    };
    const first = (await rec.call('run:start', 'g1', saved.id, SIZE)).value as { execId: string };
    const second = (await rec.call('run:start', 'g1', saved.id, SIZE)).value as {
      execId: string;
      reused: boolean;
    };
    expect(second.reused).toBe(false);
    expect(second.execId).not.toBe(first.execId);
  });

  it('refuses a rerun of a removed config with RUN_CONFIG_MISSING', async () => {
    const { rec, core } = setup();
    const saved = (await rec.call('run:saveConfig', 'g1', input())).value as { id: string };
    const started = (await rec.call('run:start', 'g1', saved.id, SIZE)).value as { execId: string };
    core.host.exit(started.execId, 0);
    await rec.call('run:removeConfig', 'g1', saved.id);
    const r = await rec.call('run:rerun', started.execId, SIZE);
    expect(r.error).toEqual({ code: 'RUN_CONFIG_MISSING', message: 'A configuração não existe mais.' });
  });
});
