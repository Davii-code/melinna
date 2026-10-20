import { describe, expect, it } from 'vitest';
import { registerCatalog } from '../../../../src/main/ipc/register-catalog';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

describe('catalog IPC', () => {
  it('lists agents and detects installation', async () => {
    const core = createFakeCore();
    const rec = handleRecorder();
    registerCatalog(rec.handle, { catalog: core.catalog, log: core.log });
    const list = await rec.call('catalog:list');
    expect(list.ok).toBe(true);
    expect((list.value as { agents: { id: string }[] }).agents.map((a) => a.id)).toEqual([
      'fake',
      'fake-resume',
      'fake-nosw',
      'bash',
    ]);
    const det = await rec.call('catalog:detectAll');
    expect((det.value as Record<string, { installed: boolean }>).fake?.installed).toBe(true);
    expect((await rec.call('catalog:list', 'extra')).error?.code).toBe('INPUT_INVALID');
  });
});
