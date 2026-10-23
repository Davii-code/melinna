import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { RunService } from '../../../../src/core/run/run-service';
import type { RunCommand, RunNeedsConfirm, RunStarted } from '../../../../src/core/run/types';
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

async function command(run: RunService, label: string, groupId = 'g1'): Promise<RunCommand> {
  const found = (await run.list()).commands.find((c) => c.groupId === groupId && c.label === label);
  if (!found) throw new Error(`sem configuração ${label}`);
  return found;
}

function started(r: RunStarted | RunNeedsConfirm): RunStarted {
  if ('needsConfirm' in r) throw new Error('pediu confirmação');
  return r;
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code: string; userMessage: string };
  }
  throw new Error('esperava falha');
}

const custom = (over: Record<string, unknown> = {}) => ({
  label: 'Servidor',
  program: 'node',
  args: ['server.js'],
  folder: '/repo',
  ...over,
});

describe('RunService.list', () => {
  it('joins every workspace with the custom configurations before the detected ones', async () => {
    const { run } = setup();
    await run.saveCommand('g1', custom());
    await run.saveCommand('g2', custom({ label: 'Outro servidor', folder: '/other' }));
    const { commands, warnings } = await run.list();
    expect(commands.map((c) => [c.groupId, c.label])).toEqual([
      ['g1', 'Servidor'],
      ['g1', 'dev'],
      ['g1', 'test'],
      ['g2', 'Outro servidor'],
      ['g2', 'start'],
    ]);
    expect(warnings).toEqual([]);
  });

  it('reports detection warnings with the workspace id', async () => {
    const { core, run } = setup();
    core.fs.seed('/repo/api/package.json', '{ "scripts":');
    const { warnings } = await run.list();
    expect(warnings).toEqual([
      { groupId: 'g1', folder: '/repo/api', message: 'package.json inválido; ignorado.' },
    ]);
  });
});

describe('RunService.start', () => {
  it('resolves a detected configuration by id on the server and launches it without a shell', async () => {
    const { core, run } = setup();
    const dev = await command(run, 'dev');
    const r = started(await run.start('g1', dev.id, SIZE));
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

  it('resolves a custom configuration by id, keeping each argument as one item', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand(
      'g1',
      custom({ args: ['-e', "console.log('oi mundo')", '; rm -rf $(x)'] }),
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
    const c = await command(run, 'a; b & $(c) d');
    started(await run.start('g1', c.id, SIZE));
    expect(core.host.spawns[0]?.args).toEqual(['run', 'a; b & $(c) d']);
  });

  it('creates a command task and execution when nothing ran before', async () => {
    const { core, run } = setup();
    const dev = await command(run, 'dev');
    const r = started(await run.start('g1', dev.id, SIZE));
    const task = core.model.task(r.taskId);
    expect(task).toMatchObject({
      groupId: 'g1',
      kind: 'command',
      isolation: 'direct',
      repoPath: '/repo',
      title: 'dev',
    });
    const exec = core.model.execution(r.execId);
    expect(exec).toMatchObject({
      taskId: r.taskId,
      agentId: 'command',
      status: 'running',
      worktreePath: '/repo',
      branch: '',
      command: { commandId: dev.id, label: 'dev', file: '/bin/npm', args: ['run', 'dev'] },
    });
  });

  it('runs in the folder of the configuration, even when it is not the main one', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom({ folder: '/repo/api' }));
    started(await run.start('g1', saved.id, SIZE));
    expect(core.host.spawns[0]?.cwd).toBe('/repo/api');
  });

  it('fails with COMMAND_STALE for an id that does not exist', async () => {
    const { run } = setup();
    const err = await failure(run.start('g1', 'nao-existe', SIZE));
    expect(err.code).toBe('COMMAND_STALE');
    expect(err.userMessage).toBe('A configuração mudou; abra o seletor de novo.');
  });

  it('does not find a configuration of another workspace', async () => {
    const { run } = setup();
    const dev = await command(run, 'dev');
    expect((await failure(run.start('g2', dev.id, SIZE))).code).toBe('COMMAND_STALE');
  });

  it('returns the live execution with reused=true', async () => {
    const { core, run } = setup();
    const dev = await command(run, 'dev');
    const first = started(await run.start('g1', dev.id, SIZE));
    const second = started(await run.start('g1', dev.id, SIZE));
    expect(second).toEqual({ ...first, reused: true });
    expect(core.host.spawns).toHaveLength(1);
    expect(core.model.raw.executions).toHaveLength(1);
  });

  it('relaunches the same execution when the previous one ended, resolving the program again', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom());
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 0);
    await run.saveCommand('g1', custom({ id: saved.id, args: ['outro.js'] }));
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
    const saved = await run.saveCommand('g1', custom({ program: 'sumiu' }));
    const err = await failure(run.start('g1', saved.id, SIZE));
    expect(err.code).toBe('PROGRAM_NOT_FOUND');
    expect(err.userMessage).toBe('Programa não encontrado: sumiu.');
  });

  it('refuses a configuration whose folder left the workspace', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom({ folder: '/repo/api' }));
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
    const saved = await run.saveCommand('g1', custom());
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

  it('two simultaneous starts of the same configuration create one execution', async () => {
    const { core, run } = setup();
    const dev = await command(run, 'dev');
    const [a, b] = (await Promise.all([run.start('g1', dev.id, SIZE), run.start('g1', dev.id, SIZE)])).map(
      started,
    );
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(a.execId).toBe(b.execId);
    expect(core.host.spawns).toHaveLength(1);
    expect(core.model.raw.executions).toHaveLength(1);
  });

  it('keeps the failed execution when the spawn fails, so the user sees why', async () => {
    const { core, run } = setup();
    core.host.spawnFailure = () => new MelinnaError('HOST_UNAVAILABLE');
    const dev = await command(run, 'dev');
    await failure(run.start('g1', dev.id, SIZE));
    expect(core.model.raw.executions[0]?.status).toBe('failed_to_start');
  });
});

describe('RunService.start — wrapper without the execute bit', () => {
  async function wrapperSetup() {
    const rig = setup();
    rig.core.fs.seed('/repo/pom.xml', '<project/>');
    rig.core.fs.seed('/repo/mvnw', '#!/bin/sh');
    rig.core.fs.setMode('/repo/mvnw', 0o644);
    const compile = await command(rig.run, 'Maven: compile');
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

  it('refuses a choice when the configuration does not use that kind of wrapper', async () => {
    const { run } = setup();
    const dev = await command(run, 'dev');
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
    const dev = await command(run, 'dev');
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
    const dev = await command(run, 'dev');
    const first = started(await run.start('g1', dev.id, SIZE));
    core.host.exit(first.execId, 1);
    await run.rerun(first.execId, SIZE);
    expect(core.host.kills).toEqual([]);
    expect(core.host.spawns).toHaveLength(2);
  });

  it('resolves the configuration again and updates the stored command', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom());
    const first = started(await run.start('g1', saved.id, SIZE));
    await run.saveCommand('g1', custom({ id: saved.id, args: ['b.js'], label: 'Renomeado' }));
    await run.rerun(first.execId, SIZE);
    expect(core.host.spawns[1]?.args).toEqual(['b.js']);
    expect(core.model.execution(first.execId)?.command).toMatchObject({ label: 'Renomeado', args: ['b.js'] });
  });

  it('fails with COMMAND_STALE when the configuration disappeared', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom());
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 0);
    await run.removeCommand('g1', saved.id);
    expect((await failure(run.rerun(first.execId, SIZE))).code).toBe('COMMAND_STALE');
    expect(core.host.spawns).toHaveLength(1);
  });

  it('fails with PROGRAM_NOT_FOUND when the program is gone', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom({ program: 'sumiu' }));
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

describe('RunService.saveCommand and removeCommand', () => {
  it('saves and returns the configuration with its availability', async () => {
    const { run } = setup();
    const saved = await run.saveCommand('g1', custom());
    expect(saved).toMatchObject({
      groupId: 'g1',
      source: 'custom',
      tool: 'custom',
      label: 'Servidor',
      available: true,
    });
  });

  it('removes a configuration', async () => {
    const { run } = setup();
    const saved = await run.saveCommand('g1', custom());
    await run.removeCommand('g1', saved.id);
    expect((await run.list()).commands.some((c) => c.id === saved.id)).toBe(false);
  });

  it('refuses to remove a configuration while its execution is alive', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom());
    started(await run.start('g1', saved.id, SIZE));
    const err = await failure(run.removeCommand('g1', saved.id));
    expect(err.code).toBe('EXECUTION_RUNNING');
    expect(err.userMessage).toBe('Pare o comando antes.');
    expect(core.model.group('g1')?.commands).toHaveLength(1);
  });
});

describe('RunService logs', () => {
  it('logs the lifecycle without arguments, programs or paths', async () => {
    const { core, run } = setup();
    const saved = await run.saveCommand('g1', custom({ args: ['--segredo=abc'] }));
    const first = started(await run.start('g1', saved.id, SIZE));
    core.host.exit(first.execId, 3);
    await run.removeCommand('g1', saved.id);
    const events = core.log.records.filter((r) => r.event.startsWith('run.'));
    expect(events.map((e) => e.event)).toEqual([
      'run.command_saved',
      'run.started',
      'run.stopped',
      'run.command_removed',
    ]);
    expect(events[0]?.fields).toEqual({ groupId: 'g1', created: true });
    expect(events[1]?.fields).toEqual({ groupId: 'g1', source: 'custom', tool: 'custom', reused: false });
    expect(events[2]?.fields).toEqual({ groupId: 'g1', exitCode: 3 });
    expect(events[3]?.fields).toEqual({ groupId: 'g1' });
    const text = JSON.stringify(events);
    expect(text).not.toContain('segredo');
    expect(text).not.toContain('node');
    expect(text).not.toContain('/repo');
  });
});
