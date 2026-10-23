import { describe, expect, it } from 'vitest';
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
  label: 'Servidor',
  program: 'node',
  args: ['server.js'],
  folder: '/repo',
  ...over,
});

describe('run IPC', () => {
  it('registers the run channels', () => {
    expect(setup().rec.channels()).toEqual([
      'run:list',
      'run:removeCommand',
      'run:rerun',
      'run:saveCommand',
      'run:start',
    ]);
  });

  it('lists the configurations of every workspace', async () => {
    const { rec } = setup();
    const r = await rec.call('run:list');
    expect(r.ok).toBe(true);
    const value = r.value as { commands: { label: string; groupId: string }[]; warnings: unknown[] };
    expect(value.commands.map((c) => [c.groupId, c.label])).toEqual([['g1', 'dev']]);
    expect(value.warnings).toEqual([]);
  });

  it('refuses arguments on list', async () => {
    expect((await setup().rec.call('run:list', 'x')).error?.code).toBe('INPUT_INVALID');
  });

  it('starts a configuration by id and reports reuse on the second start', async () => {
    const { rec, core } = setup();
    const list = (await rec.call('run:list')).value as { commands: { id: string }[] };
    const id = list.commands[0]?.id ?? '';
    const first = await rec.call('run:start', 'g1', id, SIZE);
    expect(first).toMatchObject({ ok: true, value: { reused: false } });
    expect(core.host.spawns[0]).toMatchObject({ file: '/bin/npm', args: ['run', 'dev'], cols: 80, rows: 24 });
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

  it('saves, edits and removes a custom configuration', async () => {
    const { rec, core } = setup();
    const saved = await rec.call('run:saveCommand', 'g1', input());
    expect(saved).toMatchObject({
      ok: true,
      value: { label: 'Servidor', source: 'custom', available: true },
    });
    const id = (saved.value as { id: string }).id;
    const edited = await rec.call('run:saveCommand', 'g1', input({ id, label: 'Novo' }));
    expect(edited).toMatchObject({ ok: true, value: { id, label: 'Novo' } });
    expect(await rec.call('run:removeCommand', 'g1', id)).toEqual({ ok: true, value: undefined });
    expect(core.model.group('g1')?.commands ?? []).toEqual([]);
  });

  it('validates saveCommand', async () => {
    const { rec } = setup();
    const code = async (groupId: unknown, v: unknown) =>
      (await rec.call('run:saveCommand', groupId, v)).error?.code;
    expect(await code('g1', null)).toBe('INPUT_INVALID');
    expect(await code('nao-existe', input())).toBe('INPUT_INVALID');
    expect(await code('g1', input({ label: '' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ label: 'x'.repeat(81) }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ program: '' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: 'a b' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: [1] }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: Array.from({ length: 65 }, () => 'a') }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ args: ['x'.repeat(4097)] }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ folder: '' }))).toBe('INPUT_INVALID');
    expect(await code('g1', input({ id: 'id com espaço' }))).toBe('INPUT_INVALID');
  });

  it('reports a duplicate name and a folder outside the workspace with the contract messages', async () => {
    const { rec } = setup();
    await rec.call('run:saveCommand', 'g1', input());
    expect((await rec.call('run:saveCommand', 'g1', input())).error?.message).toBe(
      'Já existe uma configuração com esse nome.',
    );
    const outside = await rec.call('run:saveCommand', 'g1', input({ label: 'Z', folder: '/fora' }));
    expect(outside.error?.message).toBe('A pasta precisa ser do workspace.');
  });

  it('refuses to remove a configuration that is running', async () => {
    const { rec } = setup();
    const saved = await rec.call('run:saveCommand', 'g1', input());
    const id = (saved.value as { id: string }).id;
    await rec.call('run:start', 'g1', id, SIZE);
    const r = await rec.call('run:removeCommand', 'g1', id);
    expect(r.error).toEqual({ code: 'EXECUTION_RUNNING', message: 'Pare o comando antes.' });
  });

  it('reruns an execution of a command and refuses one that is not', async () => {
    const { rec, core } = setup();
    const saved = await rec.call('run:saveCommand', 'g1', input());
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
