import { describe, expect, it } from 'vitest';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { makePaths, repoIdOf } from '../../../../src/core/paths';
import { emptyState } from '../../../../src/core/persistence/state-schema';
import { StateStore } from '../../../../src/core/persistence/state-store';
import { WorkspaceModel } from '../../../../src/core/workspace/workspace-model';
import { folderName, WorkspaceService } from '../../../../src/core/workspace/workspace-service';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { failed, FakeProcessRunner, ok } from '../../../support/fakes/process-runner';

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  fs.seed('/repos/site/src/index.ts', '');
  fs.seed('/repos/site/docs/README.md', '');
  fs.seed('/repos/api/package.json', '');
  fs.seed('/tmp/solta/notas.txt', '');
  const clock = new FakeClock(Date.parse('2026-10-21T09:00:00.000Z'));
  const log = new MemoryLogger();
  const model = new WorkspaceModel(emptyState(), new StateStore(fs, '/data/state.json', clock, log));
  const runner = new FakeProcessRunner()
    .on((_f, args, opts) => {
      if (!args.includes('--show-toplevel')) return undefined;
      const cwd = opts.cwd ?? '';
      if (cwd.startsWith('/repos/site')) return ok('/repos/site\n');
      if (cwd.startsWith('/repos/api')) return ok('/repos/api\n');
      return failed(128, 'fatal: not a git repository');
    })
    .on((_f, args) => (args.some((a) => a === 'HEAD^{commit}') ? ok(`${'c'.repeat(40)}\n`) : undefined))
    .on((_f, args) => (args.includes('status') ? ok('') : undefined));
  const git = new GitRunner(runner, log);
  const svc = new WorkspaceService({
    model,
    git,
    clock,
    log,
    residue: { git, fs, mutex: new KeyedMutex(), os: 'linux', paths: makePaths('/data', 'linux') },
  });
  return { svc, model, clock };
}

describe('WorkspaceService.openWorkspace', () => {
  it('creates a workspace named after the repository folder', async () => {
    const { svc } = setup();
    const ws = await svc.openWorkspace('/repos/site/src');
    expect(ws).toMatchObject({
      name: 'site',
      repoPath: '/repos/site',
      repoId: repoIdOf('/repos/site', 'linux'),
      colorIndex: 0,
      lastOpenedAt: '2026-10-21T09:00:00.000Z',
    });
    expect(svc.snapshot().groups).toHaveLength(1);
  });

  it('reuses the workspace of the same repository and refreshes its last opening', async () => {
    const { svc, clock } = setup();
    const first = await svc.openWorkspace('/repos/site');
    clock.advance(60_000);
    const again = await svc.openWorkspace('/repos/site/docs');
    expect(again.id).toBe(first.id);
    expect(again.lastOpenedAt).toBe('2026-10-21T09:01:00.000Z');
    expect(svc.snapshot().groups).toHaveLength(1);
  });

  it('gives each new workspace the next band color and accepts a custom name', async () => {
    const { svc } = setup();
    await svc.openWorkspace('/repos/site');
    const api = await svc.openWorkspace('/repos/api', 'Backend');
    expect(api).toMatchObject({ name: 'Backend', colorIndex: 1 });
  });

  it('opens a folder outside git as the folder itself', async () => {
    const { svc } = setup();
    const ws = await svc.openWorkspace('/tmp/solta');
    expect(ws).toMatchObject({
      name: 'solta',
      repoPath: '/tmp/solta',
      repoId: repoIdOf('/tmp/solta', 'linux'),
    });
    expect((await svc.openWorkspace('/tmp/solta')).id).toBe(ws.id);
  });

  it('rejects a folder that does not exist', async () => {
    const { svc } = setup();
    await expect(svc.openWorkspace('/nao/existe')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(svc.snapshot().groups).toHaveLength(0);
  });

  it('creates a direct task in any folder, without a base commit', async () => {
    const { svc } = setup();
    const ws = await svc.openWorkspace('/tmp/solta');
    const task = await svc.createTask({
      groupId: ws.id,
      repoPath: '/tmp/solta',
      baseRef: 'HEAD',
      prompt: '',
      isolation: 'direct',
    });
    expect(task).toMatchObject({
      repoPath: '/tmp/solta',
      baseCommit: '',
      isolation: 'direct',
      title: 'Sessão',
    });
  });

  it('removes a workspace only after its sessions are gone', async () => {
    const { svc } = setup();
    const ws = await svc.openWorkspace('/repos/site');
    const task = await svc.createTask({
      groupId: ws.id,
      repoPath: '/repos/site',
      baseRef: 'HEAD',
      prompt: '',
    });
    expect(() => svc.removeGroup(ws.id)).toThrow(expect.objectContaining({ code: 'INPUT_INVALID' }));
    expect(task.isolation).toBeUndefined();
    expect(() => svc.removeGroup('nao-existe')).toThrow(expect.objectContaining({ code: 'INPUT_INVALID' }));
  });

  it('marks the workspace as recently used when a task is created in it', async () => {
    const { svc, clock } = setup();
    const ws = await svc.openWorkspace('/repos/site');
    clock.advance(120_000);
    await svc.createTask({ groupId: ws.id, repoPath: '/repos/site', baseRef: 'HEAD', prompt: '' });
    expect(svc.snapshot().groups[0]?.lastOpenedAt).toBe('2026-10-21T09:02:00.000Z');
  });
});

describe('folderName', () => {
  it('uses the last folder of the path', () => {
    expect(folderName('/repos/site')).toBe('site');
    expect(folderName('C:\\work\\meu app\\')).toBe('meu app');
    expect(folderName('/')).toBe('Workspace');
    expect(folderName(`/r/${'x'.repeat(90)}`)).toHaveLength(80);
  });
});
