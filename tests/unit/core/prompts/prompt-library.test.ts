import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { makePaths } from '../../../../src/core/paths';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { PromptLibrary } from '../../../../src/core/prompts/prompt-library';
import { PromptStore } from '../../../../src/core/prompts/prompt-store';
import { WorkspaceModel } from '../../../../src/core/workspace/workspace-model';
import { WorkspaceService } from '../../../../src/core/workspace/workspace-service';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner } from '../../../support/fakes/process-runner';

const PATH = '/data/prompts.json';

async function setup(groups: string[] = ['g1', 'g2']) {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const clock = new FakeClock(Date.parse('2026-10-22T10:00:00.000Z'));
  const log = new MemoryLogger();
  const store = new PromptStore({ fs, path: PATH, clock, log, mutex: new KeyedMutex() });
  await store.load();
  const library = new PromptLibrary({ store, groupExists: (id) => groups.includes(id), clock, log });
  return { fs, clock, log, store, library };
}

describe('PromptLibrary.save', () => {
  it('creates a global prompt and detects its variables', async () => {
    const { library } = await setup();
    const p = await library.save({
      name: 'Revisar',
      body: 'Revise {{arquivo}} e aponte riscos em {{arquivo}}',
      scope: 'global',
    });
    expect(p).toMatchObject({ name: 'Revisar', scope: 'global', variables: ['arquivo'] });
    expect(p.id).toBeTruthy();
    expect(p.createdAt).toBe('2026-10-22T10:00:00.000Z');
    expect(p.updatedAt).toBe(p.createdAt);
  });

  it('persists across a reload', async () => {
    const { fs, clock, log, library } = await setup();
    await library.save({ name: 'A', body: 'x', scope: { groupId: 'g1' } });
    const store = new PromptStore({ fs, path: PATH, clock, log, mutex: new KeyedMutex() });
    await store.load();
    const again = new PromptLibrary({ store, groupExists: () => true, clock, log });
    expect(again.list('g1').map((p) => p.name)).toEqual(['A']);
  });

  it('edits keep id and creation date and bump the update date', async () => {
    const { clock, library } = await setup();
    const a = await library.save({ name: 'A', body: 'um', scope: 'global' });
    clock.advance(60_000);
    const b = await library.save({ id: a.id, name: 'B', body: 'dois {{x}}', scope: 'global' });
    expect(b).toMatchObject({ id: a.id, name: 'B', createdAt: a.createdAt, variables: ['x'] });
    expect(b.updatedAt).toBe('2026-10-22T10:01:00.000Z');
    expect(library.list()).toHaveLength(1);
  });

  it('trims the name and accepts 1 to 80 characters without line breaks', async () => {
    const { library } = await setup();
    expect((await library.save({ name: '  Oi  ', body: 'x', scope: 'global' })).name).toBe('Oi');
    await expect(library.save({ name: 'a'.repeat(80), body: 'x', scope: 'global' })).resolves.toBeDefined();
    for (const name of ['', '   ', 'a'.repeat(81), 'a\nb']) {
      await expect(library.save({ name, body: 'x', scope: 'global' })).rejects.toMatchObject({
        code: 'INPUT_INVALID',
        userMessage: 'O nome do prompt deve ter de 1 a 80 caracteres, sem quebra de linha.',
      });
    }
  });

  it('accepts a body of 1 to 100000 characters', async () => {
    const { library } = await setup();
    await expect(library.save({ name: 'A', body: 'x'.repeat(100_000), scope: 'global' })).resolves.toBeDefined();
    await expect(library.save({ name: 'A', body: 'x'.repeat(100_001), scope: 'global' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'O prompt deve ter até 100.000 caracteres.',
    });
    await expect(library.save({ name: 'A', body: '', scope: 'global' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('rejects control characters but accepts tabs and line breaks', async () => {
    const { library } = await setup();
    await expect(library.save({ name: 'A', body: 'a\tb\nc', scope: 'global' })).resolves.toBeDefined();
    await expect(library.save({ name: 'A', body: 'a\x1b[201~b', scope: 'global' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'O prompt contém caracteres de controle; remova-os.',
    });
  });

  it('normalizes CRLF to LF', async () => {
    const { library } = await setup();
    expect((await library.save({ name: 'A', body: 'a\r\nb', scope: 'global' })).body).toBe('a\nb');
  });

  it('requires an existing workspace for a workspace scope', async () => {
    const { library } = await setup();
    await expect(library.save({ name: 'A', body: 'x', scope: { groupId: 'zzz' } })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Workspace não encontrado.',
    });
  });

  it('fails with "Prompt não encontrado." when editing an unknown id', async () => {
    const { library } = await setup();
    await expect(library.save({ id: 'nope', name: 'A', body: 'x', scope: 'global' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Prompt não encontrado.',
    });
  });

  it('logs ids and sizes but never the name or the text', async () => {
    const { log, library } = await setup();
    await library.save({ name: 'NOME-SECRETO', body: 'CORPO-SECRETO', scope: 'global' });
    expect(log.events()).toContain('prompts.saved');
    expect(log.text()).not.toContain('SECRETO');
  });
});

describe('PromptLibrary.list', () => {
  it('shows global prompts everywhere and workspace prompts only in their workspace', async () => {
    const { library } = await setup();
    await library.save({ name: 'Global', body: 'x', scope: 'global' });
    await library.save({ name: 'Do G1', body: 'x', scope: { groupId: 'g1' } });
    await library.save({ name: 'Do G2', body: 'x', scope: { groupId: 'g2' } });
    expect(library.list('g1').map((p) => p.name)).toEqual(['Do G1', 'Global']);
    expect(library.list('g2').map((p) => p.name)).toEqual(['Do G2', 'Global']);
    expect(library.list().map((p) => p.name)).toEqual(['Global']);
  });
});

describe('PromptLibrary.duplicate and remove', () => {
  it('duplicates with a new id, a copy name and the same scope', async () => {
    const { library } = await setup();
    const a = await library.save({ name: 'Revisar', body: 'x {{y}}', scope: { groupId: 'g1' } });
    const copy = await library.duplicate(a.id);
    expect(copy).toMatchObject({ name: 'Revisar (cópia)', body: 'x {{y}}', scope: { groupId: 'g1' } });
    expect(copy.id).not.toBe(a.id);
    expect(library.list('g1')).toHaveLength(2);
  });

  it('keeps a duplicated name within 80 characters', async () => {
    const { library } = await setup();
    const a = await library.save({ name: 'n'.repeat(80), body: 'x', scope: 'global' });
    expect((await library.duplicate(a.id)).name.length).toBeLessThanOrEqual(80);
  });

  it('removes a prompt and reports an unknown one', async () => {
    const { library } = await setup();
    const a = await library.save({ name: 'A', body: 'x', scope: 'global' });
    await library.remove(a.id);
    expect(library.list()).toEqual([]);
    await expect(library.remove(a.id)).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Prompt não encontrado.',
    });
    await expect(library.duplicate('nope')).rejects.toMatchObject({ userMessage: 'Prompt não encontrado.' });
  });

  it('does not touch the queue when a prompt is removed', async () => {
    const { store, library } = await setup();
    const a = await library.save({ name: 'A', body: 'x', scope: 'global' });
    await store.update((d) => {
      d.queues.e1 = [{ id: 'q', text: 'resolvido', enqueuedAt: '2026-10-22T10:00:00.000Z' }];
    });
    await library.remove(a.id);
    expect(store.data().queues.e1).toHaveLength(1);
  });
});

describe('PromptLibrary workspace scope removal', () => {
  it('counts and removes only the prompts of that workspace', async () => {
    const { library } = await setup();
    await library.save({ name: 'G', body: 'x', scope: 'global' });
    await library.save({ name: 'A', body: 'x', scope: { groupId: 'g1' } });
    await library.save({ name: 'B', body: 'x', scope: { groupId: 'g1' } });
    await library.save({ name: 'C', body: 'x', scope: { groupId: 'g2' } });
    expect(library.countForGroup('g1')).toBe(2);
    expect(library.countForGroup('g2')).toBe(1);
    expect(await library.removeForGroup('g1')).toBe(2);
    expect(library.countForGroup('g1')).toBe(0);
    expect(library.list('g2').map((p) => p.name)).toEqual(['C', 'G']);
  });

  it('is triggered when WorkspaceService.removeGroup removes a workspace', async () => {
    const { fs, clock, log, store } = await setup();
    const model = new WorkspaceModel(emptyState(), new StateStore(fs, '/data/state.json', clock, log));
    const git = new GitRunner(new FakeProcessRunner(), log);
    let groupId = '';
    const library = new PromptLibrary({ store, groupExists: (id) => id === groupId, clock, log });
    const svc = new WorkspaceService({
      model,
      git,
      clock,
      log,
      residue: { git, fs, mutex: new KeyedMutex(), os: 'linux', paths: makePaths('/data', 'linux') },
      onGroupRemoved: (id) => library.releaseGroup(id),
    });
    groupId = (await svc.createGroup('Equipe')).id;
    await library.save({ name: 'A', body: 'x', scope: { groupId } });
    await library.save({ name: 'G', body: 'x', scope: 'global' });
    svc.removeGroup(groupId);
    await store.update(() => undefined);
    expect(store.data().prompts.map((p) => p.name)).toEqual(['G']);
    expect(log.events()).toContain('prompts.group_removed');
  });
});
