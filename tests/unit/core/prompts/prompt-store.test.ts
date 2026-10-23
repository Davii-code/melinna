import { describe, expect, it } from 'vitest';
import { PromptStore } from '../../../../src/core/prompts/prompt-store';
import type { StoredPrompt } from '../../../../src/core/prompts/types';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const PATH = '/data/prompts.json';

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const clock = new FakeClock(Date.parse('2026-05-04T03:02:01.000Z'));
  const log = new MemoryLogger();
  return { fs, log, store: new PromptStore({ fs, path: PATH, clock, log, mutex: new KeyedMutex() }) };
}

const prompt = (id: string): StoredPrompt => ({
  id,
  name: `P ${id}`,
  body: 'texto {{a}}',
  scope: 'global',
  createdAt: '2026-05-04T00:00:00.000Z',
  updatedAt: '2026-05-04T00:00:00.000Z',
});

describe('PromptStore', () => {
  it('starts empty when the file is missing, without writing', async () => {
    const { fs, store } = setup();
    await store.load();
    expect(store.data()).toEqual({ version: 1, prompts: [], queues: {} });
    expect(store.isReadOnly()).toBe(false);
    expect(await fs.exists(PATH)).toBe(false);
  });

  it('writes atomically through a temporary file and a rename', async () => {
    const { fs, store } = setup();
    await store.load();
    await store.update((d) => {
      d.prompts.push(prompt('p1'));
    });
    expect(fs.fsyncCount).toBe(1);
    expect(await fs.exists(`${PATH}.tmp`)).toBe(false);
    const saved = JSON.parse(fs.readText(PATH)) as { version: number; prompts: { id: string }[] };
    expect(saved.version).toBe(1);
    expect(saved.prompts.map((p) => p.id)).toEqual(['p1']);
  });

  it('reloads what it saved, including queues', async () => {
    const { fs, log, store } = setup();
    await store.load();
    await store.update((d) => {
      d.prompts.push(prompt('p1'));
      d.queues.e1 = [{ id: 'q1', text: 'oi', enqueuedAt: '2026-05-04T00:00:00.000Z' }];
    });
    const again = new PromptStore({
      fs,
      path: PATH,
      clock: new FakeClock(),
      log,
      mutex: new KeyedMutex(),
    });
    await again.load();
    expect(again.data().prompts).toHaveLength(1);
    expect(again.data().queues.e1?.[0]?.text).toBe('oi');
  });

  it('moves a corrupt file to prompts.json.bad and starts empty', async () => {
    const { fs, log, store } = setup();
    fs.seed(PATH, '{ não é json');
    await store.load();
    expect(store.data().prompts).toEqual([]);
    expect(fs.readText(`${PATH}.bad`)).toBe('{ não é json');
    expect(await fs.exists(PATH)).toBe(false);
    expect(log.events()).toContain('prompts.load_failed');
  });

  it('treats a structurally invalid file as corrupt', async () => {
    const { fs, log, store } = setup();
    fs.seed(PATH, JSON.stringify({ version: 1, prompts: 'x', queues: {} }));
    await store.load();
    expect(fs.readText(`${PATH}.bad`)).toContain('"prompts":"x"');
    expect(log.events()).toContain('prompts.load_failed');
    expect(store.isReadOnly()).toBe(false);
  });

  it('never logs prompt text when loading fails', async () => {
    const { fs, log, store } = setup();
    fs.seed(
      PATH,
      JSON.stringify({ version: 1, prompts: [{ id: 'p', name: 'SEGREDO', body: 1 }], queues: {} }),
    );
    await store.load();
    expect(log.text()).not.toContain('SEGREDO');
  });

  it('opens a newer version read-only: reads work, writes fail with IO_ERROR', async () => {
    const { fs, store } = setup();
    const newer = JSON.stringify({ version: 2, prompts: [prompt('p1')], queues: {}, extra: true });
    fs.seed(PATH, newer);
    await store.load();
    expect(store.isReadOnly()).toBe(true);
    expect(store.data().prompts).toHaveLength(1);
    await expect(store.update((d) => d.prompts.push(prompt('p2')))).rejects.toMatchObject({
      code: 'IO_ERROR',
      userMessage: expect.stringContaining('versão mais nova'),
    });
    expect(fs.readText(PATH)).toBe(newer);
  });

  it('keeps memory unchanged and reports IO_ERROR when the write fails', async () => {
    const { fs, log, store } = setup();
    await store.load();
    fs.failOn('rename', (p) => p.endsWith('prompts.json.tmp'), 'EACCES');
    await expect(store.update((d) => d.prompts.push(prompt('p1')))).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
    expect(store.data().prompts).toEqual([]);
    expect(log.events()).toContain('prompts.save_failed');
    fs.clearFailures();
    await store.update((d) => d.prompts.push(prompt('p2')));
    expect(store.data().prompts.map((p) => p.id)).toEqual(['p2']);
  });

  it('maps a full disk to DISK_FULL', async () => {
    const { fs, store } = setup();
    await store.load();
    fs.failOn('writeFile', (p) => p.endsWith('.tmp'), 'ENOSPC');
    await expect(store.update((d) => d.prompts.push(prompt('p1')))).rejects.toMatchObject({
      code: 'DISK_FULL',
    });
  });

  it('serializes concurrent updates in call order', async () => {
    const { fs, store } = setup();
    await store.load();
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        store.update((d) => {
          d.prompts.push(prompt(id));
        }),
      ),
    );
    expect(store.data().prompts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    const saved = JSON.parse(fs.readText(PATH)) as { prompts: { id: string }[] };
    expect(saved.prompts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('notifies subscribers after a committed update only', async () => {
    const { fs, store } = setup();
    await store.load();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    await store.update((d) => d.prompts.push(prompt('p1')));
    expect(calls).toBe(1);
    fs.failOn('rename', (p) => p.endsWith('prompts.json.tmp'), 'EACCES');
    await store.update((d) => d.prompts.push(prompt('p2'))).catch(() => undefined);
    expect(calls).toBe(1);
    off();
  });
});
