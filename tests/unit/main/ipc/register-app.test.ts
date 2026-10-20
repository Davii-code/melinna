import { describe, expect, it } from 'vitest';
import { CloseFlow } from '../../../../src/main/close-flow';
import { registerApp } from '../../../../src/main/ipc/register-app';
import { handleRecorder } from '../../../support/fake-core';
import { MemoryLogger } from '../../../support/fakes/logger';

describe('app IPC', () => {
  it('validates answerClose and openExternal', async () => {
    const rec = handleRecorder();
    const opened: string[] = [];
    const quits: number[] = [];
    const flow = new CloseFlow({
      liveCount: () => 1,
      stopAll: async () => undefined,
      askPage: () => undefined,
      quit: () => quits.push(1),
      log: new MemoryLogger(),
    });
    registerApp(rec.handle, {
      closeFlow: flow,
      log: new MemoryLogger(),
      open: async (u) => void opened.push(u),
    });
    expect((await rec.call('app:answerClose', 'explodir')).error?.code).toBe('INPUT_INVALID');
    flow.onCloseRequested();
    expect((await rec.call('app:answerClose', 'keep-running')).ok).toBe(true);
    expect(quits).toEqual([1]);
    expect((await rec.call('app:openExternal', 'https://example.com/a?b=1')).ok).toBe(true);
    expect(opened).toEqual(['https://example.com/a?b=1']);
  });
});
