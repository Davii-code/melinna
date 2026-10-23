import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { PreferencesStore } from '../../../../src/core/prefs/preferences-store';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const PATH = '/data/preferences.json';

function setup(initial?: string) {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  if (initial !== undefined) fs.seed(PATH, initial);
  const log = new MemoryLogger();
  return { fs, log, store: new PreferencesStore({ fs, path: PATH, log, mutex: new KeyedMutex() }) };
}

describe('PreferencesStore', () => {
  it('uses the defaults when the file is missing, without writing', async () => {
    const { fs, store } = setup();
    await store.load();
    expect(store.get()).toEqual({ keymap: 'windows', activeRun: null, readOnly: false });
    expect(await fs.exists(PATH)).toBe(false);
  });

  it('reads what is saved', async () => {
    const { store } = setup(
      JSON.stringify({ version: 1, keymap: 'intellij', activeRun: { groupId: 'g1', commandId: 'c1' } }),
    );
    await store.load();
    expect(store.get()).toEqual({
      keymap: 'intellij',
      activeRun: { groupId: 'g1', commandId: 'c1' },
      readOnly: false,
    });
  });

  it('writes atomically through a temporary file and a rename', async () => {
    const { fs, store } = setup();
    await store.load();
    await store.setKeymap('eclipse');
    expect(fs.fsyncCount).toBe(1);
    expect(await fs.exists(`${PATH}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readText(PATH))).toEqual({ version: 1, keymap: 'eclipse', activeRun: null });
  });

  it('keeps the other field when one is changed and clears the active run with null', async () => {
    const { fs, store } = setup();
    await store.load();
    await store.setKeymap('vscode');
    await store.setActiveRun({ groupId: 'g1', commandId: 'c1' });
    expect(JSON.parse(fs.readText(PATH))).toEqual({
      version: 1,
      keymap: 'vscode',
      activeRun: { groupId: 'g1', commandId: 'c1' },
    });
    await store.setActiveRun(null);
    expect(store.get()).toEqual({ keymap: 'vscode', activeRun: null, readOnly: false });
  });

  it('falls back to the defaults on invalid JSON and does not overwrite until a choice is made', async () => {
    const { fs, log, store } = setup('{ invalid json');
    await store.load();
    expect(store.get()).toEqual({ keymap: 'windows', activeRun: null, readOnly: false });
    expect(fs.readText(PATH)).toBe('{ invalid json');
    expect(log.records.some((r) => r.level === 'warn' && r.event === 'prefs.load_failed')).toBe(true);
    await store.setKeymap('intellij');
    expect(JSON.parse(fs.readText(PATH))).toEqual({ version: 1, keymap: 'intellij', activeRun: null });
  });

  it('treats an invalid keymap as windows and keeps a valid active run', async () => {
    const { store } = setup(
      JSON.stringify({ version: 1, keymap: 'emacs', activeRun: { groupId: 'g1', commandId: 'c1' } }),
    );
    await store.load();
    expect(store.get().keymap).toBe('windows');
    expect(store.get().activeRun).toEqual({ groupId: 'g1', commandId: 'c1' });
  });

  it('ignores a malformed active run', async () => {
    const { store } = setup(JSON.stringify({ version: 1, keymap: 'vscode', activeRun: { groupId: 3 } }));
    await store.load();
    expect(store.get()).toEqual({ keymap: 'vscode', activeRun: null, readOnly: false });
  });

  it('is read-only for a newer version: reads what it understands, writes only in memory', async () => {
    const original = JSON.stringify({ version: 2, keymap: 'eclipse', activeRun: null, extra: true });
    const { fs, log, store } = setup(original);
    await store.load();
    expect(store.get()).toEqual({ keymap: 'eclipse', activeRun: null, readOnly: true });
    await store.setKeymap('vscode');
    await store.setActiveRun({ groupId: 'g', commandId: 'c' });
    expect(store.get()).toEqual({
      keymap: 'vscode',
      activeRun: { groupId: 'g', commandId: 'c' },
      readOnly: true,
    });
    expect(fs.readText(PATH)).toBe(original);
    expect(log.records.some((r) => r.event === 'prefs.newer_version')).toBe(true);
  });

  it('does not change memory when the write fails', async () => {
    const { fs, store } = setup();
    await store.load();
    fs.failOn('writeFile', () => true, 'ENOSPC');
    await expect(store.setKeymap('intellij')).rejects.toMatchObject({ code: 'DISK_FULL' });
    expect(store.get().keymap).toBe('windows');
  });
});
