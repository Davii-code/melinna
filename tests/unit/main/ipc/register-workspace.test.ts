import { describe, expect, it } from 'vitest';
import { registerWorkspace } from '../../../../src/main/ipc/register-workspace';
import { BASE_SHA, createFakeCore, handleRecorder } from '../../../support/fake-core';

function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerWorkspace(rec.handle, {
    workspace: core.workspace,
    log: core.log,
    pickRepository: async (defaultPath?: string) => defaultPath ?? '/repo',
    pickFolders: async (defaultPath?: string) => (defaultPath === 'cancela' ? [] : [defaultPath ?? '/repo']),
  });
  return { core, rec };
}

describe('workspace IPC', () => {
  it('registers the workspace channels', () => {
    expect(setup().rec.channels()).toEqual([
      'workspace:cleanResidue',
      'workspace:createGroup',
      'workspace:createWorkspace',
      'workspace:inspectRepo',
      'workspace:openWorkspace',
      'workspace:pickFolders',
      'workspace:pickRepository',
      'workspace:renameGroup',
      'workspace:renameTask',
      'workspace:snapshot',
      'workspace:updateWorkspace',
    ]);
  });

  it('creates groups, inspects repos and returns snapshots', async () => {
    const { rec } = setup();
    const g = await rec.call('workspace:createGroup', 'Frente');
    expect(g).toMatchObject({ ok: true, value: { name: 'Frente' } });
    const snap = await rec.call('workspace:snapshot');
    expect((snap.value as { groups: unknown[] }).groups).toHaveLength(1);
    expect(await rec.call('workspace:inspectRepo', '/repo', 'main')).toEqual({
      ok: true,
      value: { root: '/repo', baseCommit: BASE_SHA, uncommittedCount: 0 },
    });
    expect(await rec.call('workspace:pickRepository')).toEqual({ ok: true, value: '/repo' });
    expect(await rec.call('workspace:pickRepository', '/inicio')).toEqual({ ok: true, value: '/inicio' });
    expect((await rec.call('workspace:pickRepository', 42)).error?.code).toBe('INPUT_INVALID');
  });

  it('renames groups and tasks and cleans residue', async () => {
    const { rec, core } = setup();
    const g = (await rec.call('workspace:createGroup', 'Frente')).value as { id: string };
    const task = await core.workspace.createTask({
      groupId: g.id,
      repoPath: '/repo',
      baseRef: 'main',
      prompt: 'Faça X',
    });
    expect(await rec.call('workspace:renameGroup', g.id, 'Frente B')).toEqual({ ok: true, value: undefined });
    expect(await rec.call('workspace:renameTask', task.id, 'Outro título')).toEqual({
      ok: true,
      value: undefined,
    });
    const snap = core.workspace.snapshot();
    expect(snap.groups[0]?.name).toBe('Frente B');
    expect(snap.tasks[0]?.title).toBe('Outro título');

    const residue = core.paths.worktree('0123456789abcdef', 'solto');
    core.fs.seed(`${residue}/a.txt`, 'x');
    expect(await rec.call('workspace:cleanResidue', residue)).toEqual({ ok: true, value: undefined });
    expect(await core.fs.exists(residue)).toBe(false);
    expect((await rec.call('workspace:cleanResidue', '/repo')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:cleanResidue', 7)).error?.code).toBe('INPUT_INVALID');
  });

  it('opens a folder as a workspace, reusing it on the next opening', async () => {
    const { rec } = setup();
    const first = await rec.call('workspace:openWorkspace', '/repo');
    expect(first).toMatchObject({ ok: true, value: { name: 'repo', repoPath: '/repo' } });
    const again = await rec.call('workspace:openWorkspace', '/repo/sub', 'Outro nome');
    expect((again.value as { id: string }).id).toBe((first.value as { id: string }).id);
    expect((await rec.call('workspace:openWorkspace', 42)).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:openWorkspace', '/repo', 'x'.repeat(81))).error?.code).toBe(
      'INPUT_INVALID',
    );
  });

  it('creates a workspace with several folders and a chosen primary', async () => {
    const { rec, core } = setup();
    core.fs.seed('/w/a/x', '');
    core.fs.seed('/w/b/x', '');
    const r = await rec.call('workspace:createWorkspace', {
      name: 'Plataforma',
      folders: ['/w/a', '/w/b'],
      primaryIndex: 1,
    });
    expect(r).toMatchObject({ ok: true, value: { name: 'Plataforma', repoPath: '/w/b' } });
    const group = r.value as { folders: { id: string }[]; primaryFolderId: string };
    expect(group.primaryFolderId).toBe(group.folders[1]?.id);
    const noPrimary = await rec.call('workspace:createWorkspace', { name: 'Outro', folders: ['/w/a'] });
    expect(noPrimary).toMatchObject({ ok: true, value: { repoPath: '/w/a' } });
  });

  it('createWorkspace maps core errors to INPUT_INVALID with the user message', async () => {
    const { rec } = setup();
    const r = await rec.call('workspace:createWorkspace', { name: 'X', folders: ['/nao/existe'] });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'INPUT_INVALID', message: 'A pasta /nao/existe não existe.' },
    });
  });

  it.each([
    ['non-object input', 'texto'],
    ['missing name', { folders: ['/repo'] }],
    ['empty name', { name: '', folders: ['/repo'] }],
    ['name over 80', { name: 'x'.repeat(81), folders: ['/repo'] }],
    ['folders not an array', { name: 'X', folders: '/repo' }],
    ['no folders', { name: 'X', folders: [] }],
    ['33 folders', { name: 'X', folders: Array.from({ length: 33 }, (_, i) => `/p${i}`) }],
    ['non-string folder', { name: 'X', folders: [42] }],
    ['empty folder', { name: 'X', folders: [''] }],
    ['folder over the path limit', { name: 'X', folders: ['x'.repeat(4097)] }],
    ['primaryIndex negative', { name: 'X', folders: ['/repo'], primaryIndex: -1 }],
    ['primaryIndex past the list', { name: 'X', folders: ['/repo'], primaryIndex: 1 }],
    ['primaryIndex fractional', { name: 'X', folders: ['/repo'], primaryIndex: 0.5 }],
  ])('createWorkspace rejects %s', async (_name, input) => {
    const { rec, core } = setup();
    expect((await rec.call('workspace:createWorkspace', input)).error?.code).toBe('INPUT_INVALID');
    expect(core.workspace.snapshot().groups).toHaveLength(0);
  });

  it('picks folders: a list, [] when cancelled, and passes the default path', async () => {
    const { rec } = setup();
    expect(await rec.call('workspace:pickFolders')).toEqual({ ok: true, value: ['/repo'] });
    expect(await rec.call('workspace:pickFolders', '/inicio')).toEqual({ ok: true, value: ['/inicio'] });
    expect(await rec.call('workspace:pickFolders', 'cancela')).toEqual({ ok: true, value: [] });
    expect((await rec.call('workspace:pickFolders', 42)).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:pickFolders', 'a', 'b')).error?.code).toBe('INPUT_INVALID');
  });

  async function created(setupResult: ReturnType<typeof setup>, folders: string[]) {
    for (const f of folders) setupResult.core.fs.seed(`${f}/x`, '');
    const r = await setupResult.rec.call('workspace:createWorkspace', { name: 'Plat', folders });
    return r.value as { id: string; folders: { id: string; path: string }[] };
  }

  it('updateWorkspace applies each kind of change and returns the updated workspace', async () => {
    const s = setup();
    const g = await created(s, ['/w/a']);

    const renamed = await s.rec.call('workspace:updateWorkspace', g.id, { kind: 'rename', name: 'Novo' });
    expect(renamed).toMatchObject({ ok: true, value: { name: 'Novo' } });

    s.core.fs.seed('/w/b/x', '');
    const added = await s.rec.call('workspace:updateWorkspace', g.id, {
      kind: 'addFolders',
      folders: ['/w/b'],
    });
    const folders = (added.value as { folders: { id: string; path: string }[] }).folders;
    expect(folders.map((f) => f.path)).toEqual(['/w/a', '/w/b']);

    const primary = await s.rec.call('workspace:updateWorkspace', g.id, {
      kind: 'setPrimary',
      folderId: folders[1]?.id,
    });
    expect(primary).toMatchObject({ ok: true, value: { repoPath: '/w/b' } });

    const removed = await s.rec.call('workspace:updateWorkspace', g.id, {
      kind: 'removeFolder',
      folderId: folders[1]?.id,
    });
    expect(removed).toMatchObject({ ok: true, value: { repoPath: '/w/a' } });
  });

  it('updateWorkspace refuses removing the only folder with the core message', async () => {
    const s = setup();
    const g = await created(s, ['/w/a']);
    const r = await s.rec.call('workspace:updateWorkspace', g.id, {
      kind: 'removeFolder',
      folderId: g.folders[0]?.id,
    });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'INPUT_INVALID', message: 'Um workspace precisa de ao menos uma pasta.' },
    });
  });

  it('updateWorkspace refuses an unknown folder id with the core message', async () => {
    const s = setup();
    const g = await created(s, ['/w/a']);
    const r = await s.rec.call('workspace:updateWorkspace', g.id, {
      kind: 'setPrimary',
      folderId: 'nao-existe',
    });
    expect(r.error?.message).toBe('Pasta não encontrada neste workspace.');
  });

  it.each([
    ['unknown workspace id', 'nao-existe', { kind: 'rename', name: 'X' }],
    ['non-object change', 'GROUP', 'rename'],
    ['unknown kind', 'GROUP', { kind: 'apagar' }],
    ['rename without name', 'GROUP', { kind: 'rename' }],
    ['rename with a name over 80', 'GROUP', { kind: 'rename', name: 'x'.repeat(81) }],
    ['addFolders with no folders', 'GROUP', { kind: 'addFolders', folders: [] }],
    ['addFolders with a non-string', 'GROUP', { kind: 'addFolders', folders: [1] }],
    ['removeFolder without id', 'GROUP', { kind: 'removeFolder' }],
    ['setPrimary with a malformed id', 'GROUP', { kind: 'setPrimary', folderId: '../x' }],
  ])('updateWorkspace rejects %s', async (_name, target, change) => {
    const s = setup();
    const g = await created(s, ['/w/a']);
    const r = await s.rec.call('workspace:updateWorkspace', target === 'GROUP' ? g.id : target, change);
    expect(r.error?.code).toBe('INPUT_INVALID');
  });

  it('validates types, sizes and ids', async () => {
    const { rec } = setup();
    expect((await rec.call('workspace:createGroup', 42)).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:createGroup', 'x'.repeat(81))).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:renameGroup', 'nao-existe', 'n')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:renameTask', 'nao-existe', 't')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('workspace:inspectRepo', '/repo', 'x'.repeat(300))).error?.code).toBe(
      'INPUT_INVALID',
    );
    expect((await rec.call('workspace:inspectRepo', '/repo', 'nao-existe')).error?.code).toBe(
      'BASE_REF_NOT_FOUND',
    );
  });
});
