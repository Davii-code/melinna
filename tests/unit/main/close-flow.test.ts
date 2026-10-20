import { describe, expect, it } from 'vitest';
import { CloseFlow } from '../../../src/main/close-flow';
import { MemoryLogger } from '../../support/fakes/logger';

function setup(live: number) {
  const calls: string[] = [];
  const flow = new CloseFlow({
    liveCount: () => live,
    stopAll: async (ms) => {
      calls.push(`stopAll:${ms}`);
    },
    askPage: (info) => calls.push(`ask:${info.liveCount}`),
    quit: () => calls.push('quit'),
    log: new MemoryLogger(),
  });
  return { flow, calls };
}

describe('close flow', () => {
  it('closes directly without live executions', () => {
    const { flow, calls } = setup(0);
    expect(flow.onCloseRequested()).toBe(true);
    expect(calls).toEqual([]);
  });

  it('asks the page once when there are live executions', () => {
    const { flow, calls } = setup(3);
    expect(flow.onCloseRequested()).toBe(false);
    expect(flow.onCloseRequested()).toBe(false);
    expect(calls).toEqual(['ask:3']);
  });

  it('keep-running quits without stopping the host', async () => {
    const { flow, calls } = setup(2);
    flow.onCloseRequested();
    await flow.answer('keep-running');
    expect(calls).toEqual(['ask:2', 'quit']);
    expect(flow.onCloseRequested()).toBe(true);
  });

  it('stop-all stops everything with 5 s of grace then quits', async () => {
    const { flow, calls } = setup(2);
    flow.onCloseRequested();
    await flow.answer('stop-all');
    expect(calls).toEqual(['ask:2', 'stopAll:5000', 'quit']);
  });

  it('cancel keeps the window open and asks again next time', async () => {
    const { flow, calls } = setup(1);
    flow.onCloseRequested();
    await flow.answer('cancel');
    expect(flow.onCloseRequested()).toBe(false);
    expect(calls).toEqual(['ask:1', 'ask:1']);
  });

  it('ignores answers when nothing was asked', async () => {
    const { flow, calls } = setup(1);
    await flow.answer('stop-all');
    expect(calls).toEqual([]);
  });
});
