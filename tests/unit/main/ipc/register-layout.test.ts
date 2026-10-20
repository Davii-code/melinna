import { describe, expect, it } from 'vitest';
import { registerLayout } from '../../../../src/main/ipc/register-layout';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

async function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerLayout(rec.handle, { model: core.model, log: core.log });
  const g = await core.workspace.createGroup('G');
  const t = await core.workspace.createTask({
    groupId: g.id,
    repoPath: '/repo',
    baseRef: 'main',
    prompt: 'p',
  });
  const res = await core.executions.launch(t.id, [{ agentId: 'fake' }, { agentId: 'fake' }], {
    cols: 80,
    rows: 24,
  });
  return { core, rec, ids: res.map((r) => r.execId!) };
}

const layout = (ids: string[]) => ({
  mode: 'custom',
  openExecutionIds: ids,
  focusedExecutionId: ids[0] ?? null,
  custom: {
    columns: [0.25, 0.75],
    rows: [1],
    cells: { [ids[0]!]: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
  },
});

describe('layout IPC', () => {
  it('gets the default and persists a valid layout in state.json', async () => {
    const { rec, ids, core } = await setup();
    expect((await rec.call('layout:get')).value).toMatchObject({ mode: 'auto', openExecutionIds: [] });
    expect((await rec.call('layout:set', layout(ids))).ok).toBe(true);
    expect((await rec.call('layout:get')).value).toMatchObject({
      mode: 'custom',
      openExecutionIds: ids,
      custom: { columns: [0.25, 0.75] },
    });
    core.clock.advance(300);
    await core.store.flush();
    expect(JSON.parse(core.fs.readText('/data/state.json')).layout.mode).toBe('custom');
  });

  it('drops unknown execution ids', async () => {
    const { rec, ids } = await setup();
    await rec.call('layout:set', {
      ...layout(ids),
      openExecutionIds: [...ids, 'fantasma'],
      focusedExecutionId: 'fantasma',
    });
    expect((await rec.call('layout:get')).value).toMatchObject({
      openExecutionIds: ids,
      focusedExecutionId: null,
    });
  });

  it('rejects invalid layouts', async () => {
    const { rec, ids } = await setup();
    const bad = async (v: unknown) => (await rec.call('layout:set', v)).error?.code;
    expect(await bad({ ...layout(ids), mode: 'mosaico' })).toBe('INPUT_INVALID');
    expect(await bad({ ...layout(ids), custom: { columns: [0.5, 0.6], rows: [1], cells: {} } })).toBe(
      'INPUT_INVALID',
    );
    expect(
      await bad({
        ...layout(ids),
        custom: { columns: [1], rows: [1], cells: { [ids[0]!]: { col: 1, row: 0, colSpan: 1, rowSpan: 1 } } },
      }),
    ).toBe('INPUT_INVALID');
    expect(
      await bad({ ...layout(ids), openExecutionIds: Array.from({ length: 13 }, (_, i) => `e${i}`) }),
    ).toBe('INPUT_INVALID');
    expect(await bad({ ...layout(ids), openExecutionIds: [ids[0], ids[0]] })).toBe('INPUT_INVALID');
  });
});
