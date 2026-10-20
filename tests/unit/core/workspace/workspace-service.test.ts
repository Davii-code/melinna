import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { makePaths } from '../../../../src/core/paths';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { WorkspaceModel } from '../../../../src/core/workspace/workspace-model';
import { WorkspaceService } from '../../../../src/core/workspace/workspace-service';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner, failed, ok } from '../../../support/fakes/process-runner';

const SHA = 'a'.repeat(40);

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const clock = new FakeClock(Date.parse('2026-02-03T04:05:06.000Z'));
  const log = new MemoryLogger();
  const store = new StateStore(fs, '/data/state.json', clock, log);
  const model = new WorkspaceModel(emptyState(), store);
  const runner = new FakeProcessRunner()
    .on((_f, args) => (args.includes('--show-toplevel') ? ok('/repos/app\n') : undefined))
    .on((_f, args) => (args.some((a) => a === 'main^{commit}') ? ok(`${SHA}\n`) : undefined))
    .on((_f, args) => (args.some((a) => a.endsWith('^{commit}')) ? failed(1) : undefined))
    .on((_f, args) => (args.includes('status') ? ok(' M a.txt\0?? b.txt\0') : undefined));
  const git = new GitRunner(runner, log);
  const svc = new WorkspaceService({
    model,
    git,
    clock,
    log,
    residue: { git, fs, mutex: new KeyedMutex(), os: 'linux', paths: makePaths('/data', 'linux') },
  });
  return { fs, clock, svc, model, runner, store };
}

describe('WorkspaceService', () => {
  it('creates groups and tasks and publishes immutable snapshots to subscribers', async () => {
    const { svc } = setup();
    const seen: number[] = [];
    svc.subscribe((s) => seen.push(s.groups.length + s.tasks.length));
    const g = await svc.createGroup('  Frente A ');
    expect(g.name).toBe('Frente A');
    const t = await svc.createTask({
      groupId: g.id,
      repoPath: '/repos/app/src',
      baseRef: 'main',
      prompt: 'Corrija a função de ação\nDetalhes...',
    });
    expect(t).toMatchObject({
      groupId: g.id,
      title: 'Corrija a função de ação',
      repoPath: '/repos/app',
      baseRef: 'main',
      baseCommit: SHA,
      slug: 'corrija-a-funcao-de-acao',
      createdAt: '2026-02-03T04:05:06.000Z',
    });
    expect(t.repoId).toMatch(/^[0-9a-f]{16}$/);
    expect(seen).toEqual([1, 2]);
    const snap = svc.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.tasks[0])).toBe(true);
    expect(() => (snap.groups as unknown as unknown[]).push({})).toThrow();
  });

  it('persists through the state store', async () => {
    const { svc, fs, clock, store } = setup();
    await svc.createGroup('G');
    clock.advance(300);
    await store.flush();
    expect(JSON.parse(fs.readText('/data/state.json')).groups[0].name).toBe('G');
  });

  it('validates names, prompts and the group', async () => {
    const { svc } = setup();
    await expect(svc.createGroup('')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.createGroup('a\nb')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(svc.createGroup('x'.repeat(81))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const g = await svc.createGroup('G');
    await expect(
      svc.createTask({ groupId: 'nope', repoPath: '/r', baseRef: 'main', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(
      svc.createTask({ groupId: g.id, repoPath: '/r', baseRef: 'main', prompt: 'a\0b' }),
    ).rejects.toMatchObject({ code: 'PROMPT_INVALID' });
    await expect(
      svc.createTask({ groupId: g.id, repoPath: '/r', baseRef: 'main', prompt: '   ' }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(
      svc.createTask({ groupId: g.id, repoPath: '/r', baseRef: 'zzz', prompt: 'x' }),
    ).rejects.toMatchObject({ code: 'BASE_REF_NOT_FOUND' });
  });

  it('forwards inspectRepo with the uncommitted count', async () => {
    const { svc } = setup();
    expect(await svc.inspectRepo('/repos/app', 'main')).toEqual({
      root: '/repos/app',
      baseCommit: SHA,
      uncommittedCount: 2,
    });
  });
});
