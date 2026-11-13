import { describe, expect, it, vi } from 'vitest';
import { ProtocolClient } from '../../../../src/core/ide/protocol-client';
import type { ProtocolProcess } from '../../../../src/core/ports/protocol-process';
import { encodeMessage, MessageFramer } from '../../../../src/core/ide/framing';
import { FakeClock } from '../../../support/fakes/clock';

function setup(protocol: 'lsp' | 'dap' = 'lsp') {
  let receive: (bytes: Uint8Array) => void = () => undefined;
  let exit: () => void = () => undefined;
  const sent: Record<string, unknown>[] = [];
  const parser = new MessageFramer();
  const process: ProtocolProcess = {
    write: (bytes) => {
      sent.push(...parser.push(bytes));
    },
    onData: (fn) => {
      receive = fn;
      return () => {
        receive = () => undefined;
      };
    },
    onExit: (fn) => {
      exit = fn;
      return () => {
        exit = () => undefined;
      };
    },
    close: vi.fn(),
  };
  const clock = new FakeClock();
  const events = vi.fn();
  const client = new ProtocolClient(protocol, process, clock, events);
  return {
    client,
    sent,
    clock,
    events,
    process,
    reply: (message: Record<string, unknown>) => receive(encodeMessage(message)),
    exit: () => exit(),
  };
}

describe('ProtocolClient', () => {
  it('correlates responses and delivers notifications independently', async () => {
    const s = setup();
    const response = s.client.request('initialize', {});
    s.reply({ jsonrpc: '2.0', method: 'window/logMessage', params: {} });
    s.reply({ jsonrpc: '2.0', id: s.sent[0]?.id, result: { capabilities: {} } });
    await expect(response).resolves.toEqual({ capabilities: {} });
    expect(s.events).toHaveBeenCalledTimes(1);
    expect(s.clock.pending()).toBe(0);
  });
  it('times out requests and rejects pending work on exit', async () => {
    const s = setup();
    const first = s.client.request('initialize', {});
    const check = expect(first).rejects.toThrow();
    s.clock.advance(20_000);
    await check;
    const second = s.client.request('initialize', {});
    const checkExit = expect(second).rejects.toThrow();
    s.exit();
    await checkExit;
    expect(s.clock.pending()).toBe(0);
  });
  it('uses DAP sequence and request_seq rather than JSON-RPC ids', async () => {
    const s = setup('dap');
    const response = s.client.request('threads', {});
    expect(s.sent[0]).toMatchObject({ type: 'request', command: 'threads', seq: 1 });
    s.reply({
      seq: 2,
      type: 'response',
      request_seq: 1,
      command: 'threads',
      success: true,
      body: { threads: [] },
    });
    await expect(response).resolves.toEqual({ threads: [] });
    s.client.close();
    expect(s.process.close).toHaveBeenCalledOnce();
  });
});
