import { describe, expect, it } from 'vitest';
import { registerLifecycle } from '../../../../src/main/ipc/register-lifecycle';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';
import { failed, ok } from '../../../support/fakes/process-runner';

async function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerLifecycle(rec.handle, { executions: core.executions, model: core.model, log: core.log });
  const g = await core.workspace.createGroup('G');
  const task = await core.workspace.createTask({
    groupId: g.id,
    repoPath: '/repo',
    baseRef: 'main',
    prompt: 'Faça X',
  });
  const [r] = await core.executions.launch(task.id, [{ agentId: 'fake' }], { cols: 80, rows: 24 });
  if (!r?.ok) throw new Error('lançamento falhou');
  return { core, rec, execId: r.execId };
}

describe('lifecycle IPC', () => {
  it('registers the lifecycle channels', async () => {
    const { rec } = await setup();
    expect(rec.channels()).toEqual([
      'executions:relaunch',
      'executions:removalCheck',
      'executions:remove',
      'executions:stop',
    ]);
  });

  it('stops, relaunches and removes an execution', async () => {
    const { rec, core, execId } = await setup();
    expect(await rec.call('executions:stop', execId)).toEqual({ ok: true, value: undefined });
    expect(core.host.kills).toEqual([execId]);
    expect(core.model.execution(execId)?.status).toBe('exited');

    expect(await rec.call('executions:relaunch', execId, { cols: 90, rows: 30 })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(core.host.spawns).toHaveLength(2);
    expect(core.host.spawns[1]).toMatchObject({ cols: 90, rows: 30 });
    expect(core.host.spawns[1]?.separator).toMatch(/relançado em/);

    await rec.call('executions:stop', execId);
    const check = await rec.call('executions:removalCheck', execId);
    expect(check).toMatchObject({ ok: true, value: { uncommittedFiles: 0, unmergedCommits: 0 } });
    expect(await rec.call('executions:remove', execId, { deleteBranch: true, force: false })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(core.model.execution(execId)).toBeUndefined();
  });

  it('maps WORK_WOULD_BE_LOST with the counts', async () => {
    const { rec, core, execId } = await setup();
    await rec.call('executions:stop', execId);
    core.fs.seed(`${core.model.execution(execId)!.worktreePath}/a.txt`, 'x');
    core.runner.prepend((_f, args) => (args.includes('status') ? ok(' M a.txt\0?? b.txt\0') : undefined));
    const r = await rec.call('executions:remove', execId, { deleteBranch: false, force: false });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'WORK_WOULD_BE_LOST', details: { uncommittedFiles: 2, unmergedCommits: 0 } },
    });
    expect(core.model.execution(execId)).toBeDefined();
  });

  it('refuses stop of an ended execution and remove of a live one', async () => {
    const { rec, execId } = await setup();
    expect(
      (await rec.call('executions:remove', execId, { deleteBranch: true, force: true })).error?.code,
    ).toBe('EXECUTION_RUNNING');
    await rec.call('executions:stop', execId);
    expect((await rec.call('executions:stop', execId)).error?.code).toBe('EXECUTION_NOT_RUNNING');
  });

  it('validates ids, sizes and options', async () => {
    const { rec, core, execId } = await setup();
    const code = async (ch: string, ...args: unknown[]) => (await rec.call(ch, ...args)).error?.code;
    expect(await code('executions:stop', 'nao-existe')).toBe('INPUT_INVALID');
    expect(await code('executions:stop', 42)).toBe('INPUT_INVALID');
    expect(await code('executions:relaunch', execId, { cols: 5, rows: 5 })).toBe('INPUT_INVALID');
    expect(await code('executions:relaunch', execId)).toBe('INPUT_INVALID');
    expect(await code('executions:removalCheck', 'nao-existe')).toBe('INPUT_INVALID');
    expect(await code('executions:remove', execId, { deleteBranch: 'sim', force: false })).toBe(
      'INPUT_INVALID',
    );
    expect(await code('executions:remove', execId, { deleteBranch: true })).toBe('INPUT_INVALID');
    expect(await code('executions:remove', execId, null)).toBe('INPUT_INVALID');
    expect(core.host.kills).toHaveLength(0);
  });

  it('reports git failures of removalCheck as GIT_FAILED', async () => {
    const { rec, core, execId } = await setup();
    await rec.call('executions:stop', execId);
    core.runner.prepend((_f, args) =>
      args.includes('rev-list') ? failed(128, 'fatal: bad revision') : undefined,
    );
    expect((await rec.call('executions:removalCheck', execId)).error?.code).toBe('GIT_FAILED');
  });
});
