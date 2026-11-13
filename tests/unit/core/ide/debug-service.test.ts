import { describe, expect, it, vi } from 'vitest';
import { DebugService } from '../../../../src/core/ide/debug-service';

describe('DebugService', () => {
  it('sends launch before waiting for initialized and configures breakpoints before configurationDone', async () => {
    const calls: string[] = [];
    let finishLaunch!: (value: unknown) => void;
    const client = {
      request: vi.fn(async (method: string) => {
        calls.push(method);
        if (method === 'initialize') return { supportsConfigurationDoneRequest: true };
        if (method === 'launch')
          return new Promise((resolve) => {
            finishLaunch = resolve;
          });
        if (method === 'configurationDone') finishLaunch({});
        return {};
      }),
      close: vi.fn(),
    };
    const service = new DebugService(client);
    await service.initialize();
    await service.request('setBreakpoints', { source: { path: '/repo/a' }, breakpoints: [{ line: 2 }] });
    const launched = service.request('launch', {});
    await service.event({ type: 'event', event: 'initialized' });
    await launched;
    expect(calls).toEqual(['initialize', 'launch', 'setBreakpoints', 'configurationDone']);
    service.close();
    expect(client.close).toHaveBeenCalledOnce();
  });
});
