import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { makePaths, repoIdOf } from '../../../../src/core/paths';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { WorkspaceModel } from '../../../../src/core/workspace/workspace-model';
import { WorkspaceService } from '../../../../src/core/workspace/workspace-service';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { failed, FakeProcessRunner, ok } from '../../../support/fakes/process-runner';

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  fs.seed('/repos/site/src/index.ts', '');
  fs.seed('/repos/api/package.json', '');
  fs.seed('/tmp/solta/notas.txt', '');
  const clock = new FakeClock(Date.parse('2026-10-22T09:00:00.000Z'));
  const log = new MemoryLogger();
  const model = new WorkspaceModel(emptyState(), new StateStore(fs, '/data/state.json', clock, log));
  const runner = new FakeProcessRunner().on((_f, args) =>
    args.includes('--show-toplevel')
      ? ok('/repos/site\n')
      : args.includes('status')
        ? ok('')
        : failed(128, 'fatal: not a git repository'),
  );
  const git = new GitRunner(runner, log);
  const svc = new WorkspaceService({
    model,
    git,
    clock,
    log,
    residue: { git, fs, mutex: new KeyedMutex(), os: 'linux', paths: makePaths('/data', 'linux') },
  });
  return { svc, model, log, clock };
}

describe('WorkspaceService.createWorkspace', () => {
  it('creates a workspace with the folders in order, the first as primary', async () => {
    const { svc } = setup();
    const ws = await svc.createWorkspace('Plataforma', ['/repos/site', '/repos/api']);
    expect(ws).toMatchObject({
      name: 'Plataforma',
      repoPath: '/repos/site',
      repoId: repoIdOf('/repos/site', 'linux'),
      colorIndex: 0,
      lastOpenedAt: '2026-10-22T09:00:00.000Z',
    });
    expect(ws.folders?.map((f) => f.path)).toEqual(['/repos/site', '/repos/api']);
    expect(ws.primaryFolderId).toBe(ws.folders?.[0]?.id);
    expect(svc.snapshot().groups).toHaveLength(1);
  });

  it('uses primaryIndex to choose the primary folder and derives repoPath from it', async () => {
    const { svc } = setup();
    const ws = await svc.createWorkspace('Plataforma', ['/repos/site', '/repos/api'], 1);
    expect(ws.primaryFolderId).toBe(ws.folders?.[1]?.id);
    expect(ws.repoPath).toBe('/repos/api');
    expect(ws.repoId).toBe(repoIdOf('/repos/api', 'linux'));
  });

  it('refuses a primaryIndex outside the list', async () => {
    const { svc } = setup();
    await expect(svc.createWorkspace('X', ['/repos/site'], 3)).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Escolha a pasta principal entre as pastas do workspace.',
    });
    expect(svc.snapshot().groups).toHaveLength(0);
  });

  it.each(['', '   ', 'a\nb', 'x'.repeat(81)])('refuses the invalid name %j', async (name) => {
    const { svc } = setup();
    await expect(svc.createWorkspace(name, ['/repos/site'])).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'O nome do workspace deve ter de 1 a 80 caracteres, sem quebra de linha.',
    });
  });

  it('accepts a name of exactly 80 characters, trimmed', async () => {
    const { svc } = setup();
    const ws = await svc.createWorkspace(`  ${'x'.repeat(80)}  `, ['/repos/site']);
    expect(ws.name).toHaveLength(80);
  });

  it('requires at least one folder', async () => {
    const { svc } = setup();
    await expect(svc.createWorkspace('X', [])).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Um workspace precisa de ao menos uma pasta.',
    });
  });

  it('refuses a folder that does not exist and creates nothing', async () => {
    const { svc } = setup();
    await expect(svc.createWorkspace('X', ['/repos/site', '/nao/existe'])).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'A pasta /nao/existe não existe.',
    });
    expect(svc.snapshot().groups).toHaveLength(0);
  });

  it('refuses a file where a folder is expected', async () => {
    const { svc } = setup();
    await expect(svc.createWorkspace('X', ['/tmp/solta/notas.txt'])).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('refuses a repeated folder', async () => {
    const { svc } = setup();
    await expect(svc.createWorkspace('X', ['/repos/site', '/repos/site/'])).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
  });

  it('keeps a folder inside a repository as chosen, without climbing to the repository root', async () => {
    const { svc } = setup();
    const ws = await svc.createWorkspace('Só o src', ['/repos/site/src']);
    expect(ws.folders?.[0]?.path).toBe('/repos/site/src');
    expect(ws.repoPath).toBe('/repos/site/src');
  });

  it('allows the same folder in two workspaces', async () => {
    const { svc } = setup();
    await svc.createWorkspace('A', ['/repos/site']);
    const b = await svc.createWorkspace('B', ['/repos/site', '/repos/api']);
    expect(b.colorIndex).toBe(1);
    expect(svc.snapshot().groups).toHaveLength(2);
  });

  it('logs workspace.created with the id and the folder count, never the paths', async () => {
    const { svc, log } = setup();
    const ws = await svc.createWorkspace('Plataforma', ['/repos/site', '/repos/api']);
    const entry = log.records.find((e) => e.event === 'workspace.created');
    expect(entry?.fields).toEqual({ groupId: ws.id, folders: 2 });
    expect(log.text()).not.toContain('/repos/api');
  });
});

describe('WorkspaceService.openWorkspace — pastas', () => {
  it('records the single folder as the primary one', async () => {
    const { svc } = setup();
    const ws = await svc.openWorkspace('/tmp/solta');
    expect(ws.folders).toHaveLength(1);
    expect(ws.folders?.[0]?.path).toBe('/tmp/solta');
    expect(ws.primaryFolderId).toBe(ws.folders?.[0]?.id);
  });
});
