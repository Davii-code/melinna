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
import { FakeProcessRunner, ok } from '../../../support/fakes/process-runner';

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  for (const dir of ['/w/site', '/w/api', '/w/web', '/w/docs']) fs.seed(`${dir}/leia.txt`, '');
  const clock = new FakeClock(Date.parse('2026-10-22T09:00:00.000Z'));
  const log = new MemoryLogger();
  const model = new WorkspaceModel(emptyState(), new StateStore(fs, '/data/state.json', clock, log));
  const git = new GitRunner(new FakeProcessRunner().on(() => ok('')), log);
  const mutex = new KeyedMutex();
  const svc = new WorkspaceService({
    model,
    git,
    clock,
    log,
    residue: { git, fs, mutex, os: 'linux', paths: makePaths('/data', 'linux') },
  });
  return { svc, fs, log, model, mutex };
}

async function created(s: ReturnType<typeof setup>, folders = ['/w/site', '/w/api']) {
  return s.svc.createWorkspace('Plataforma', folders);
}

const paths = (g: { folders?: { path: string }[] }) => g.folders?.map((f) => f.path);

describe('WorkspaceService.updateWorkspace', () => {
  it('renames, trimming, and keeps the folders', async () => {
    const s = setup();
    const ws = await created(s);
    const out = await s.svc.updateWorkspace(ws.id, { kind: 'rename', name: '  Nova  ' });
    expect(out.name).toBe('Nova');
    expect(paths(out)).toEqual(['/w/site', '/w/api']);
  });

  it.each(['', '   ', 'a\nb', 'x'.repeat(81)])('refuses the invalid name %j', async (name) => {
    const s = setup();
    const ws = await created(s);
    await expect(s.svc.updateWorkspace(ws.id, { kind: 'rename', name })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'O nome do workspace deve ter de 1 a 80 caracteres, sem quebra de linha.',
    });
    expect(s.model.group(ws.id)?.name).toBe('Plataforma');
  });

  it('adds folders to the end, keeping the primary', async () => {
    const s = setup();
    const ws = await created(s);
    const out = await s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/web', '/w/docs'] });
    expect(paths(out)).toEqual(['/w/site', '/w/api', '/w/web', '/w/docs']);
    expect(out.primaryFolderId).toBe(ws.primaryFolderId);
    expect(out.repoPath).toBe('/w/site');
  });

  it('refuses a duplicate and applies nothing from the same call', async () => {
    const s = setup();
    const ws = await created(s);
    await expect(
      s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/web', '/w/api/'] }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID', userMessage: 'A pasta /w/api já está neste workspace.' });
    expect(paths(s.model.group(ws.id) ?? {})).toEqual(['/w/site', '/w/api']);
  });

  it('refuses a folder that does not exist', async () => {
    const s = setup();
    const ws = await created(s);
    await expect(
      s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/nao/existe'] }),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID', userMessage: 'A pasta /nao/existe não existe.' });
  });

  it('refuses more than 32 folders', async () => {
    const s = setup();
    const many = Array.from({ length: 32 }, (_, i) => {
      s.fs.seed(`/m/p${i}/x`, '');
      return `/m/p${i}`;
    });
    const ws = await s.svc.createWorkspace('Cheio', many);
    await expect(s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/web'] })).rejects.toMatchObject({
      userMessage: 'Um workspace pode ter no máximo 32 pastas.',
    });
  });

  it('refuses removing the only folder', async () => {
    const s = setup();
    const ws = await created(s, ['/w/site']);
    await expect(
      s.svc.updateWorkspace(ws.id, { kind: 'removeFolder', folderId: ws.primaryFolderId ?? '' }),
    ).rejects.toMatchObject({ userMessage: 'Um workspace precisa de ao menos uma pasta.' });
    expect(paths(s.model.group(ws.id) ?? {})).toEqual(['/w/site']);
  });

  it('removes a folder and keeps the primary', async () => {
    const s = setup();
    const ws = await created(s, ['/w/site', '/w/api', '/w/web']);
    const api = ws.folders?.[1]?.id ?? '';
    const out = await s.svc.updateWorkspace(ws.id, { kind: 'removeFolder', folderId: api });
    expect(paths(out)).toEqual(['/w/site', '/w/web']);
    expect(out.primaryFolderId).toBe(ws.primaryFolderId);
  });

  it('promotes the next folder when the primary is removed, and re-derives repoPath and repoId', async () => {
    const s = setup();
    const ws = await created(s, ['/w/site', '/w/api', '/w/web']);
    const out = await s.svc.updateWorkspace(ws.id, {
      kind: 'removeFolder',
      folderId: ws.primaryFolderId ?? '',
    });
    expect(out.primaryFolderId).toBe(out.folders?.[0]?.id);
    expect(out.repoPath).toBe('/w/api');
    expect(out.repoId).toBe(repoIdOf('/w/api', 'linux'));
  });

  it('promotes the previous folder when the removed primary was the last one', async () => {
    const s = setup();
    const ws = await s.svc.createWorkspace('P', ['/w/site', '/w/api', '/w/web'], 2);
    const out = await s.svc.updateWorkspace(ws.id, {
      kind: 'removeFolder',
      folderId: ws.primaryFolderId ?? '',
    });
    expect(out.repoPath).toBe('/w/api');
  });

  it('changes the primary and re-derives repoPath', async () => {
    const s = setup();
    const ws = await created(s);
    const out = await s.svc.updateWorkspace(ws.id, { kind: 'setPrimary', folderId: ws.folders?.[1]?.id ?? '' });
    expect(out.primaryFolderId).toBe(ws.folders?.[1]?.id);
    expect(out.repoPath).toBe('/w/api');
    expect(out.repoId).toBe(repoIdOf('/w/api', 'linux'));
  });

  it('refuses an unknown folder id for setPrimary and removeFolder', async () => {
    const s = setup();
    const ws = await created(s);
    for (const kind of ['setPrimary', 'removeFolder'] as const) {
      await expect(s.svc.updateWorkspace(ws.id, { kind, folderId: 'nao-existe' })).rejects.toMatchObject({
        userMessage: 'Pasta não encontrada neste workspace.',
      });
    }
  });

  it('refuses an unknown workspace', async () => {
    const s = setup();
    await expect(s.svc.updateWorkspace('nao-existe', { kind: 'rename', name: 'X' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Workspace não encontrado.',
    });
  });

  it('writes nothing in the user folders', async () => {
    const s = setup();
    const ws = await created(s);
    const before = new Set(s.fs.files.keys());
    await s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/web'] });
    await s.svc.updateWorkspace(ws.id, { kind: 'setPrimary', folderId: ws.folders?.[1]?.id ?? '' });
    await s.svc.updateWorkspace(ws.id, { kind: 'removeFolder', folderId: ws.folders?.[0]?.id ?? '' });
    await s.svc.updateWorkspace(ws.id, { kind: 'rename', name: 'Outro' });
    const added = [...s.fs.files.keys()].filter((k) => !before.has(k));
    expect(added.filter((k) => /[\\/]w[\\/]/.test(k))).toEqual([]);
  });

  it('adds a first folder to a legacy group that has none, making it the primary', async () => {
    const s = setup();
    const legacy = await s.svc.createGroup('Manual');
    const out = await s.svc.updateWorkspace(legacy.id, { kind: 'addFolders', folders: ['/w/site', '/w/api'] });
    expect(paths(out)).toEqual(['/w/site', '/w/api']);
    expect(out.repoPath).toBe('/w/site');
    expect(out.primaryFolderId).toBe(out.folders?.[0]?.id);
  });

  it('serializes concurrent edits of the same workspace', async () => {
    const s = setup();
    const ws = await created(s, ['/w/site']);
    await Promise.all([
      s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/api'] }),
      s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/web'] }),
      s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/docs'] }),
    ]);
    expect(paths(s.model.group(ws.id) ?? {})).toEqual(['/w/site', '/w/api', '/w/web', '/w/docs']);
  });

  it('holds the workspace key in the mutex while an edit runs', async () => {
    const s = setup();
    const ws = await created(s);
    const pending = s.svc.updateWorkspace(ws.id, { kind: 'rename', name: 'Novo' });
    expect(s.mutex.isLocked(`workspace:${ws.id}`)).toBe(true);
    await pending;
    expect(s.mutex.isLocked(`workspace:${ws.id}`)).toBe(false);
  });

  it('logs workspace.updated with the group id, the folder count and the kind, never the paths', async () => {
    const s = setup();
    const ws = await created(s);
    await s.svc.updateWorkspace(ws.id, { kind: 'addFolders', folders: ['/w/web'] });
    const entry = s.log.records.find((r) => r.event === 'workspace.updated');
    expect(entry?.fields).toEqual({ groupId: ws.id, folders: 3, change: 'addFolders' });
    expect(s.log.text()).not.toContain('/w/web');
  });
});

describe('WorkspaceService.refreshFolderAvailability', () => {
  it('flags folders that no longer exist in the snapshot, and clears them when they return', async () => {
    const s = setup();
    const ws = await created(s);
    const [site, api] = ws.folders ?? [];
    expect(s.svc.snapshot().folderAvailability).toEqual({ [site?.id ?? '']: true, [api?.id ?? '']: true });
    s.fs.failOn('stat', '/w/api', 'ENOENT');
    await s.svc.refreshFolderAvailability();
    expect(s.svc.snapshot().folderAvailability).toEqual({ [site?.id ?? '']: true, [api?.id ?? '']: false });
    s.fs.clearFailures();
    await s.svc.refreshFolderAvailability();
    expect(s.svc.snapshot().folderAvailability[api?.id ?? '']).toBe(true);
  });

  it('notifies subscribers only when the availability changes', async () => {
    const s = setup();
    await created(s);
    let calls = 0;
    s.svc.subscribe(() => calls++);
    await s.svc.refreshFolderAvailability();
    expect(calls).toBe(0);
    s.fs.failOn('stat', '/w/api', 'ENOENT');
    await s.svc.refreshFolderAvailability();
    expect(calls).toBe(1);
  });
});
