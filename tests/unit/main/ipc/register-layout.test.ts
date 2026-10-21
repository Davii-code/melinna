import { describe, expect, it } from 'vitest';
import { FilesService } from '../../../../src/core/files/files-service';
import { registerLayout } from '../../../../src/main/ipc/register-layout';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { currentOs } from '../../../support/os';

async function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  const fs = new MemoryFileSystem();
  const files = new FilesService({
    fs,
    os: currentOs,
    log: new MemoryLogger(),
    roots: () => [{ path: '/repo', label: 'repo', kind: 'workspace' }],
  });
  fs.seed('/repo/a.txt', 'oi');
  registerLayout(rec.handle, { model: core.model, files, log: core.log });
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
  return { core, rec, fs, ids: res.map((r) => r.execId!) };
}

const layout = (ids: string[]) => ({
  mode: 'custom',
  panes: ids.map((id) => ({ id, kind: 'executions', execIds: [id], activeIndex: 0 })),
  focusedPaneId: ids[0] ?? null,
  custom: {
    columns: [0.25, 0.75],
    rows: [1],
    cells: { [ids[0]!]: { col: 0, row: 0, colSpan: 1, rowSpan: 1 } },
  },
});

describe('layout IPC', () => {
  it('gets the default and persists a valid layout in state.json', async () => {
    const { rec, ids, core } = await setup();
    expect((await rec.call('layout:get')).value).toMatchObject({ mode: 'auto', panes: [] });
    expect((await rec.call('layout:set', layout(ids))).ok).toBe(true);
    const got = (await rec.call('layout:get')).value as {
      mode: string;
      panes: unknown[];
      custom: { columns: number[] };
    };
    expect(got.mode).toBe('custom');
    expect(got.panes).toHaveLength(ids.length);
    expect(got.panes[0]).toMatchObject({ id: ids[0], kind: 'executions', execIds: [ids[0]] });
    expect(got.custom.columns).toEqual([0.25, 0.75]);
    core.clock.advance(300);
    await core.store.flush();
    expect(JSON.parse(core.fs.readText('/data/state.json')).layout.mode).toBe('custom');
  });

  it('drops unknown execution ids and panes that end up empty', async () => {
    const { rec, ids } = await setup();
    await rec.call('layout:set', {
      ...layout(ids),
      panes: [
        ...layout(ids).panes,
        { id: 'fantasma', kind: 'executions', execIds: ['fantasma'], activeIndex: 0 },
      ],
      focusedPaneId: 'fantasma',
    });
    const got = (await rec.call('layout:get')).value as {
      panes: { id: string }[];
      focusedPaneId: string | null;
    };
    expect(got.panes.map((p) => p.id)).toEqual(ids);
    // o painel em foco sumiu: o foco cai no primeiro painel válido
    expect(got.focusedPaneId).toBe(ids[0]);
  });

  it('drops editor tabs outside the navigable roots', async () => {
    const { rec } = await setup();
    await rec.call('layout:set', {
      mode: 'auto',
      panes: [
        { id: 'editor-1', kind: 'editor', docs: ['/repo/a.txt', '/fora/segredo.txt'], activeIndex: 1 },
      ],
      focusedPaneId: 'editor-1',
      custom: { columns: [1], rows: [1], cells: {} },
    });
    const got = (await rec.call('layout:get')).value as {
      panes: { docs: string[]; activeIndex: number }[];
    };
    expect(got.panes).toEqual([{ id: 'editor-1', kind: 'editor', docs: ['/repo/a.txt'], activeIndex: 0 }]);
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
      await bad({
        ...layout(ids),
        panes: Array.from({ length: 13 }, (_, i) => ({
          id: `e${i}`,
          kind: 'executions',
          execIds: [`e${i}`],
          activeIndex: 0,
        })),
      }),
    ).toBe('INPUT_INVALID');
    expect(
      await bad({
        ...layout(ids),
        panes: [
          { id: 'dup', kind: 'executions', execIds: [ids[0]], activeIndex: 0 },
          { id: 'dup', kind: 'executions', execIds: [ids[1]], activeIndex: 0 },
        ],
      }),
    ).toBe('INPUT_INVALID');
    // aba ativa fora do intervalo e painel sem abas
    expect(
      await bad({
        ...layout(ids),
        panes: [{ id: ids[0], kind: 'executions', execIds: [ids[0]!], activeIndex: 3 }],
      }),
    ).toBe('INPUT_INVALID');
    expect(
      await bad({ ...layout(ids), panes: [{ id: 'vazio', kind: 'executions', execIds: [], activeIndex: 0 }] }),
    ).toBe('INPUT_INVALID');
  });
});
