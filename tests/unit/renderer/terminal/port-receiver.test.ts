import { describe, expect, it } from 'vitest';
import { createPortReceiver } from '../../../../src/renderer/terminal/port-receiver';

function post(data: unknown, opts: { source?: unknown; origin?: string; port?: MessagePort | null } = {}) {
  const { port1 } = new MessageChannel();
  const ev = new MessageEvent('message', {
    data,
    origin: opts.origin ?? window.location.origin,
    source: (opts.source === undefined ? window : opts.source) as MessageEventSource | null,
    ports: opts.port === null ? [] : [opts.port ?? port1],
  });
  window.dispatchEvent(ev);
  return port1;
}

const envelope = (execId: string, channelId: string) => ({ source: 'melinna-terminal', execId, channelId });

describe('port receiver', () => {
  it('resolves the pending open with the port whose channel id matches', async () => {
    const r = createPortReceiver(window);
    const w = r.expect('e1');
    const port = post(envelope('e1', 'c1'));
    await expect(w.take('c1', 1000)).resolves.toBe(port);
    r.dispose();
  });

  it('also works when the port arrives after take() is called', async () => {
    const r = createPortReceiver(window);
    const w = r.expect('e1');
    const p = w.take('c2', 1000);
    post(envelope('e1', 'c1'));
    const port = post(envelope('e1', 'c2'));
    await expect(p).resolves.toBe(port);
    r.dispose();
  });

  it('ignores other sources, origins, envelopes and executions without a pending open', async () => {
    const r = createPortReceiver(window);
    const w = r.expect('e1');
    post(envelope('e1', 'c1'), { source: null });
    post(envelope('e1', 'c1'), { origin: 'https://evil.example' });
    post({ source: 'outro', execId: 'e1', channelId: 'c1' });
    post(envelope('e1', 'c1'), { port: null });
    post(envelope('e2', 'c1'));
    await expect(w.take('c1', 50)).rejects.toThrow('não chegou');
    r.dispose();
  });

  it('cancel rejects a pending take', async () => {
    const r = createPortReceiver(window);
    const w = r.expect('e1');
    const p = w.take('c1', 1000);
    w.cancel();
    await expect(p).rejects.toThrow('cancelada');
    r.dispose();
  });
});
