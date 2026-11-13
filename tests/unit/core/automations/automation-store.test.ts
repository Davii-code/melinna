import { describe, expect, it, vi } from 'vitest';
import { AutomationStore } from '../../../../src/core/automations/automation-store';
import type { AutomationInput } from '../../../../src/core/automations/types';
import type { MelinnaError } from '../../../../src/core/errors';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const PATH = '/data/automations.json';

const INPUT: AutomationInput = {
  name: 'Atualizar dependências',
  folder: '/repos/site',
  agentId: 'claude',
  prompt: 'Atualize as dependências e rode os testes.',
  schedule: { kind: 'daily', time: '02:00', days: [] },
  enabled: true,
  isolation: 'worktree',
};

function setup(fs = new MemoryFileSystem()) {
  const clock = new FakeClock(Date.parse('2026-03-01T10:00:00.000Z'));
  const log = new MemoryLogger();
  let n = 0;
  const store = new AutomationStore({
    fs,
    path: PATH,
    clock,
    log,
    mutex: new KeyedMutex(),
    newId: () => `a${++n}`,
  });
  return { store, fs, clock, log };
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('deveria ter falhado');
}

const onDisk = async (fs: MemoryFileSystem) =>
  JSON.parse(new TextDecoder().decode(await fs.readFile(PATH))) as {
    version: number;
    automations: unknown[];
  };

describe('AutomationStore', () => {
  it('starts empty without a file', async () => {
    const { store } = setup();
    await store.load();
    expect(store.list()).toEqual([]);
    expect(store.isReadOnly()).toBe(false);
  });

  it('creates an automation, writes it to disk and notifies', async () => {
    const { store, fs } = setup();
    const changed = vi.fn();
    store.subscribe(changed);
    const saved = await store.save(INPUT);
    expect(saved).toEqual({ ...INPUT, id: 'a1', createdAt: '2026-03-01T10:00:00.000Z', lastRun: null });
    expect((await onDisk(fs)).automations).toEqual([saved]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('reloads what it saved', async () => {
    const { store, fs } = setup();
    await store.save(INPUT);
    await store.recordRun('a1', { at: '2026-03-02T02:00:00.000Z', status: 'launched', taskId: 't1' });
    const again = setup(fs).store;
    await again.load();
    expect(again.list()).toEqual(store.list());
    expect(again.get('a1')?.lastRun?.taskId).toBe('t1');
  });

  it('keeps the last run when editing without touching the schedule, and resets it otherwise', async () => {
    const { store, clock } = setup();
    await store.save(INPUT);
    await store.recordRun('a1', { at: '2026-03-02T02:00:00.000Z', status: 'launched' });
    const renamed = await store.save({ ...INPUT, id: 'a1', name: 'Outro nome' });
    expect(renamed.lastRun?.status).toBe('launched');
    expect(renamed.createdAt).toBe('2026-03-01T10:00:00.000Z');
    clock.advance(60_000);
    const moved = await store.save({ ...INPUT, id: 'a1', schedule: { kind: 'interval', minutes: 30 } });
    expect(moved.lastRun).toBeNull();
    expect(moved.createdAt).toBe('2026-03-01T10:01:00.000Z');
  });

  it('validates the fields and never writes an invalid automation', async () => {
    const { store, fs } = setup();
    const bad: Array<[Partial<Record<keyof AutomationInput, unknown>>, RegExp]> = [
      [{ name: '   ' }, /nome/i],
      [{ name: 'x'.repeat(81) }, /Nome/],
      [{ folder: '' }, /Pasta/],
      [{ agentId: 'Claude Code' }, /Agente/],
      [{ prompt: '  ' }, /enunciado/i],
      [{ prompt: 'rm -rf\x1b[2J' }, /controle/],
      [{ schedule: { kind: 'daily', time: '25:00', days: [] } }, /HH:MM/],
      [{ isolation: 'container' }, /Isolamento/],
      [{ enabled: 'sim' }, /Estado/],
    ];
    for (const [over, pattern] of bad) {
      const err = await failure(store.save({ ...INPUT, ...over }));
      expect(err.code).toBe('INPUT_INVALID');
      expect(err.userMessage).toMatch(pattern);
    }
    expect((await failure(store.save(null))).code).toBe('INPUT_INVALID');
    expect(await fs.exists(PATH)).toBe(false);
  });

  it('refuses to edit, remove or toggle an unknown automation', async () => {
    const { store } = setup();
    expect((await failure(store.save({ ...INPUT, id: 'nao-existe' }))).userMessage).toBe(
      'Automação não encontrada.',
    );
    expect((await failure(store.remove('nao-existe'))).code).toBe('INPUT_INVALID');
    expect((await failure(store.setEnabled('nao-existe', false))).code).toBe('INPUT_INVALID');
  });

  it('toggles and removes', async () => {
    const { store } = setup();
    await store.save(INPUT);
    await store.setEnabled('a1', false);
    expect(store.get('a1')?.enabled).toBe(false);
    await store.remove('a1');
    expect(store.list()).toEqual([]);
  });

  it('ignores the result of a run for an automation removed meanwhile', async () => {
    const { store } = setup();
    await expect(store.recordRun('sumiu', { at: 'x', status: 'failed' })).resolves.toBeUndefined();
  });

  it('drops invalid entries of the file and keeps the valid ones', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(
      PATH,
      JSON.stringify({
        version: 1,
        automations: [
          {
            ...INPUT,
            id: 'boa',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastRun: { at: 'x', status: 'estranho' },
          },
          { ...INPUT, id: 'ruim', createdAt: '2026-01-01T00:00:00.000Z', schedule: { kind: 'cron' } },
          'lixo',
        ],
      }),
    );
    const { store, log } = setup(fs);
    await store.load();
    expect(store.list().map((a) => a.id)).toEqual(['boa']);
    expect(store.get('boa')?.lastRun).toBeNull();
    expect(log.events()).toContain('automations.entries_dropped');
  });

  it('treats a broken file as empty and a newer version as read-only', async () => {
    const broken = new MemoryFileSystem();
    broken.seed(PATH, '{ não é json');
    const a = setup(broken);
    await a.store.load();
    expect(a.store.list()).toEqual([]);
    expect(a.log.events()).toContain('automations.load_failed');

    const newer = new MemoryFileSystem();
    const original = JSON.stringify({ version: 2, automations: [] });
    newer.seed(PATH, original);
    const b = setup(newer);
    await b.store.load();
    expect(b.store.isReadOnly()).toBe(true);
    await b.store.save(INPUT);
    expect(b.store.list()).toHaveLength(1);
    expect(new TextDecoder().decode(await newer.readFile(PATH))).toBe(original);
  });

  it('never logs the prompt', async () => {
    const { store, log } = setup();
    await store.save(INPUT);
    expect(log.text()).not.toContain('Atualize as dependências');
  });
});

it('keeps missed occurrences after a successful run and reload', async () => {
  const { store } = setup();
  const automation = await store.save(INPUT);
  const missed = {
    at: '2026-03-02T10:00:00.000Z',
    status: 'missed' as const,
    detail: '2026-03-02T09:00:00.000Z',
  };
  await store.recordRun(automation.id, missed);
  await store.recordRun(automation.id, { at: '2026-03-03T09:00:00.000Z', status: 'launched', taskId: 't1' });
  await store.load();
  expect(store.get(automation.id)?.runs).toEqual([
    missed,
    { at: '2026-03-03T09:00:00.000Z', status: 'launched', taskId: 't1' },
  ]);
});
