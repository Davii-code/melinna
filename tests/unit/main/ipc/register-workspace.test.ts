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
  });
  return { core, rec };
}

describe('workspace IPC', () => {
  it('registers the workspace channels', () => {
    expect(setup().rec.channels()).toEqual([
      'workspace:cleanResidue',
      'workspace:createGroup',
      'workspace:inspectRepo',
      'workspace:openWorkspace',
      'workspace:pickRepository',
      'workspace:renameGroup',
      'workspace:renameTask',
      'workspace:snapshot',
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
