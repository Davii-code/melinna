import { describe, expect, it } from 'vitest';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const clock = new FakeClock(Date.parse('2026-05-04T03:02:01.000Z'));
  const log = new MemoryLogger();
  return { fs, clock, log, store: new StateStore(fs, '/data/state.json', clock, log) };
}

describe('StateStore', () => {
  it('loads an empty workspace when the file is missing', async () => {
    const { store } = setup();
    expect(await store.load()).toEqual({ state: emptyState(), readOnly: false });
  });

  it('saves atomically after a 300 ms debounce, coalescing calls', async () => {
    const { fs, clock, store } = setup();
    const a = emptyState();
    store.save({ ...a, groups: [{ id: 'g1', name: 'A', order: 0 }] });
    clock.advance(200);
    store.save({ ...a, groups: [{ id: 'g2', name: 'B', order: 0 }] });
    clock.advance(299);
    expect(await fs.exists('/data/state.json')).toBe(false);
    clock.advance(1);
    await store.flush();
    const saved = JSON.parse(fs.readText('/data/state.json')) as { groups: { id: string }[] };
    expect(saved.groups.map((g) => g.id)).toEqual(['g2']);
    expect(fs.fsyncCount).toBe(1);
    expect((await store.load()).state.groups).toHaveLength(1);
  });

  it('renames a corrupt file and opens an empty workspace with a warning', async () => {
    const { fs, store, log } = setup();
    fs.seed('/data/state.json', '{ não é json');
    const r = await store.load();
    expect(r.warning).toBe('corrupt');
    expect(r.state).toEqual(emptyState());
    expect(r.corruptBackupPath).toBe('/data/state.corrupt-2026-05-04T03-02-01-000Z.json');
    expect(fs.readText('/data/state.corrupt-2026-05-04T03-02-01-000Z.json')).toBe('{ não é json');
    expect(await fs.exists('/data/state.json')).toBe(false);
    expect(log.events()).toContain('state.corrupt');
  });

  it('treats a structurally invalid file as corrupt', async () => {
    const { fs, store } = setup();
    fs.seed('/data/state.json', JSON.stringify({ schemaVersion: 1, groups: 'x' }));
    expect((await store.load()).warning).toBe('corrupt');
  });

  it('opens a newer schema read-only and never writes it', async () => {
    const { fs, clock, store } = setup();
    fs.seed('/data/state.json', JSON.stringify({ ...emptyState(), schemaVersion: 99 }));
    const r = await store.load();
    expect(r).toMatchObject({ readOnly: true, warning: 'newer-schema' });
    store.save(emptyState());
    clock.advance(1000);
    await store.flush();
    expect(JSON.parse(fs.readText('/data/state.json')).schemaVersion).toBe(99);
  });

  it('keeps the previous file when a save fails', async () => {
    const { fs, store, log } = setup();
    fs.seed('/data/state.json', JSON.stringify(emptyState()));
    fs.failOn('rename', '/data/state.json.tmp', 'ENOSPC');
    store.save({ ...emptyState(), groups: [{ id: 'g', name: 'G', order: 0 }] });
    await store.flush();
    expect(JSON.parse(fs.readText('/data/state.json')).groups).toEqual([]);
    expect(log.events()).toContain('state.save_failed');
  });
});
