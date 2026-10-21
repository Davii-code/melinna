import { describe, expect, it } from 'vitest';
import { registerTasks } from '../../../../src/main/ipc/register-tasks';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

async function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerTasks(rec.handle, { workspace: core.workspace, executions: core.executions, log: core.log });
  const g = await core.workspace.createGroup('G');
  const input = {
    groupId: g.id,
    repoPath: '/repo',
    baseRef: 'main',
    prompt: 'Faça X',
    picks: [{ agentId: 'fake' }],
    size: { cols: 80, rows: 24 },
  };
  return { core, rec, input };
}

describe('tasks IPC', () => {
  it('creates the task and launches one execution per pick', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', {
      ...input,
      picks: [{ agentId: 'fake' }, { agentId: 'fake', model: 'esperto' }],
    });
    expect(r.ok).toBe(true);
    const value = r.value as { taskId: string; results: { ok: boolean }[] };
    expect(value.results.map((x) => x.ok)).toEqual([true, true]);
    expect(core.host.spawns).toHaveLength(2);
    expect(core.host.spawns[1]?.args).toEqual(['--model', 'esperto', 'Faça X']);
  });

  it('accepts an empty prompt and launches without it', async () => {
    const { rec, core, input } = await setup();
    const r = await rec.call('tasks:createAndLaunch', { ...input, prompt: '' });
    expect(r.ok).toBe(true);
    expect(core.host.spawns[0]?.args).toEqual(['--model', 'rapido']);
  });

  it('validates the payload', async () => {
    const { rec, input } = await setup();
    const bad = async (v: unknown) => (await rec.call('tasks:createAndLaunch', v)).error?.code;
    expect(await bad(null)).toBe('INPUT_INVALID');
    expect(await bad({ ...input, picks: [] })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, picks: [{ agentId: 'Mau' }] })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, groupId: 'nao-existe' })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, prompt: 'x'.repeat(100_001) })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, size: { cols: 5, rows: 5 } })).toBe('INPUT_INVALID');
    expect(await bad({ ...input, picks: Array.from({ length: 13 }, () => ({ agentId: 'fake' })) })).toBe(
      'LIMIT_REACHED',
    );
    expect(await bad({ ...input, baseRef: 'nao-existe' })).toBe('BASE_REF_NOT_FOUND');
  });
});
