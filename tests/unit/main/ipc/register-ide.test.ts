import { describe, expect, it, vi } from 'vitest';
import { registerIde } from '../../../../src/main/ipc/register-ide';
import { handleRecorder } from '../../../support/fake-core';
import { MemoryLogger } from '../../../support/fakes/logger';
import { CHANNELS } from '../../../../src/shared/ipc-contract';

describe('IDE IPC', () => {
  it('validates envelopes and refuses arbitrary protocol commands before dispatch', async () => {
    const rec = handleRecorder();
    const ide = { start: vi.fn(), call: vi.fn(), stop: vi.fn() };
    const http = { send: vi.fn(), cancel: vi.fn() };
    const database = { open: vi.fn(), query: vi.fn(), close: vi.fn() };
    registerIde(rec.handle, { ide, http, database, log: new MemoryLogger() });
    expect(rec.channels()).toEqual(Object.values(CHANNELS.ide).sort());
    expect((await rec.call('ide:start', { protocol: 'shell' })).error?.code).toBe('INPUT_INVALID');
    expect(
      (await rec.call('ide:call', { sessionId: 's', method: 'workspace/executeCommand', params: {} })).error
        ?.code,
    ).toBe('INPUT_INVALID');
    expect(ide.call).not.toHaveBeenCalled();
    await rec.call('ide:notify', {
      sessionId: 's',
      method: 'textDocument/didClose',
      params: { textDocument: { uri: 'file:///repo/a' } },
    });
    expect(ide.call).toHaveBeenCalledWith(expect.objectContaining({ method: 'textDocument/didClose' }), true);
    await rec.call('ide:stop', 's');
    expect(ide.stop).toHaveBeenCalledWith('s');
    expect((await rec.call('ide:dbQuery', 's', '')).error?.code).toBe('INPUT_INVALID');
  });
});
