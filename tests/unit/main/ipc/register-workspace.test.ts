import { describe, expect, it } from 'vitest';
import { registerWorkspace } from '../../../../src/main/ipc/register-workspace';
import { BASE_SHA, createFakeCore, handleRecorder } from '../../../support/fake-core';

function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  registerWorkspace(rec.handle, {
    workspace: core.workspace,
    log: core.log,
    pickRepository: async () => '/repo',
  });
  return { core, rec };
}

describe('workspace IPC', () => {
  it('registers the workspace channels', () => {
    expect(setup().rec.channels()).toEqual([
      'workspace:cleanResidue',
      'workspace:createGroup',
      'workspace:inspectRepo',
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
