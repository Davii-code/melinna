import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { PreferencesStore } from '../../../../src/core/prefs/preferences-store';
import { registerPrefs } from '../../../../src/main/ipc/register-prefs';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

async function setup() {
  const state = emptyState();
  state.groups.push({ id: 'g1', name: 'App', order: 0 });
  const core = createFakeCore(state);
  const store = new PreferencesStore({
    fs: core.fs,
    path: '/data/preferences.json',
    log: core.log,
    mutex: new KeyedMutex(),
  });
  await store.load();
  const rec = handleRecorder();
  registerPrefs(rec.handle, { prefs: store, model: core.model, log: core.log });
  return { core, rec, store };
}

describe('prefs IPC', () => {
  it('registers the prefs channels', async () => {
    expect((await setup()).rec.channels()).toEqual(['prefs:get', 'prefs:setActiveRun', 'prefs:setKeymap']);
  });

  it('gets the defaults', async () => {
    const { rec } = await setup();
    expect(await rec.call('prefs:get')).toEqual({
      ok: true,
      value: { keymap: 'windows', activeRun: null, readOnly: false },
    });
  });

  it('sets the keymap, persists it and logs the change with nothing else', async () => {
    const { rec, core } = await setup();
    expect(await rec.call('prefs:setKeymap', 'intellij')).toEqual({ ok: true, value: undefined });
    expect((await rec.call('prefs:get')).value).toMatchObject({ keymap: 'intellij' });
    expect(JSON.parse(core.fs.readText('/data/preferences.json')).keymap).toBe('intellij');
    const logged = core.log.records.filter((r) => r.event === 'prefs.keymap_changed');
    expect(logged.map((r) => r.fields)).toEqual([{ keymap: 'intellij' }]);
  });

  it('rejects an unknown keymap', async () => {
    const { rec, store } = await setup();
    for (const bad of ['emacs', '', 3, null, undefined]) {
      expect((await rec.call('prefs:setKeymap', bad)).error?.code).toBe('INPUT_INVALID');
    }
    expect(store.get().keymap).toBe('windows');
  });

  it('sets and clears the active configuration', async () => {
    const { rec } = await setup();
    const ref = { groupId: 'g1', commandId: 'a1b2c3d4e5f60718' };
    expect(await rec.call('prefs:setActiveRun', ref)).toEqual({ ok: true, value: undefined });
    expect((await rec.call('prefs:get')).value).toMatchObject({ activeRun: ref });
    expect(await rec.call('prefs:setActiveRun', null)).toEqual({ ok: true, value: undefined });
    expect((await rec.call('prefs:get')).value).toMatchObject({ activeRun: null });
  });

  it('validates the active configuration', async () => {
    const { rec } = await setup();
    const code = async (v: unknown) => (await rec.call('prefs:setActiveRun', v)).error?.code;
    expect(await code({ groupId: 'nao-existe', commandId: 'abc' })).toBe('INPUT_INVALID');
    expect(await code({ groupId: 'g1', commandId: 'id com espaço' })).toBe('INPUT_INVALID');
    expect(await code({ groupId: 'g1' })).toBe('INPUT_INVALID');
    expect(await code('g1')).toBe('INPUT_INVALID');
    expect(await code(undefined)).toBe('INPUT_INVALID');
  });
});
