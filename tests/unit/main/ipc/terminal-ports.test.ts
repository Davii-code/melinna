import { describe, expect, it } from 'vitest';
import { TerminalBridge, type MainPort } from '../../../../src/main/ipc/terminal-ports';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';

class FakePort implements MainPort {
  sent: unknown[] = [];
  started = false;
  closed = false;
  private listener: ((e: { data: unknown }) => void) | undefined;
  postMessage(message: unknown): void {
    if (this.closed) throw new Error('fechado');
    this.sent.push(message);
  }
  on(_event: 'message', fn: (e: { data: unknown }) => void): void {
    this.listener = fn;
  }
  start(): void {
    this.started = true;
  }
  close(): void {
    this.closed = true;
  }
  fromPage(data: unknown): void {
    this.listener?.({ data });
  }
}

async function setup() {
  const core = createFakeCore();
  const ports: FakePort[] = [];
  const posted: { channel: string; message: unknown; transfer: unknown[] }[] = [];
  const bridge = new TerminalBridge({
    executions: core.executions,
    model: core.model,
    log: core.log,
    createChannel: () => {
      const port1 = new FakePort();
      ports.push(port1);
      return { port1, port2: { id: `port2-${ports.length}` } };
    },
    target: () => ({
      postMessage: (channel, message, transfer) => posted.push({ channel, message, transfer }),
    }),
  });
  const rec = handleRecorder();
  bridge.register(rec.handle);
  const g = await core.workspace.createGroup('G');
  const t = await core.workspace.createTask({
    groupId: g.id,
    repoPath: '/repo',
    baseRef: 'main',
    prompt: 'p',
  });
  const [r] = await core.executions.launch(t.id, [{ agentId: 'fake' }], { cols: 80, rows: 24 });
  const execId = r!.execId!;
  return { core, bridge, rec, ports, posted, execId };
}

describe('terminal bridge', () => {
  it('sends port2 with webContents.postMessage and resolves the channel id', async () => {
    const { rec, posted, ports, execId } = await setup();
    const res = await rec.call('terminal:open', execId);
    expect(res.ok).toBe(true);
    const { channelId } = res.value as { channelId: string };
    expect(posted).toEqual([
      { channel: 'terminal:port', message: { execId, channelId }, transfer: [{ id: 'port2-1' }] },
    ]);
    expect(ports[0]?.started).toBe(true);
  });

  it('forwards replay markers, data and exit to the page', async () => {
    const { rec, ports, core, execId } = await setup();
    core.host.output(execId, 'antes');
    await rec.call('terminal:open', execId);
    core.host.output(execId, 'depois');
    core.host.exit(execId, 2);
    const msgs = ports[0]!.sent as { type: string; offset?: number; bytes?: Uint8Array }[];
    expect(msgs.map((m) => m.type)).toEqual(['replay-start', 'data', 'replay-end', 'data', 'exit']);
    expect(new TextDecoder().decode(msgs[1]!.bytes)).toBe('antes');
    expect(msgs[3]!.offset).toBe(5);
    expect(msgs[4]).toEqual({ type: 'exit', exitCode: 2, signal: null });
  });

  it('accepts input up to 64 KB, resize within limits and relays ack', async () => {
    const { rec, ports, core, execId } = await setup();
    await rec.call('terminal:open', execId);
    const port = ports[0]!;
    port.fromPage({ type: 'input', bytes: new TextEncoder().encode('ls\r') });
    port.fromPage({ type: 'input', bytes: new Uint8Array(64 * 1024 + 1) });
    port.fromPage({ type: 'input', bytes: 'texto' });
    port.fromPage({ type: 'resize', cols: 120, rows: 40 });
    port.fromPage({ type: 'resize', cols: 10, rows: 40 });
    port.fromPage({ type: 'resize', cols: 120.5, rows: 40 });
    port.fromPage({ type: 'ack', offset: 262144 });
    port.fromPage({ type: 'ack', offset: -1 });
    port.fromPage({ type: 'nope' });
    expect(core.host.writesFor(execId)).toBe('ls\r');
    expect(core.host.resizes).toEqual([{ execId, cols: 120, rows: 40 }]);
    expect(core.host.acks).toEqual([{ execId, offset: 262144 }]);
  });

  it('terminal:close detaches without killing; reopening replaces the previous port', async () => {
    const { rec, ports, core, execId } = await setup();
    await rec.call('terminal:open', execId);
    await rec.call('terminal:open', execId);
    expect(ports[0]?.closed).toBe(true);
    expect(await rec.call('terminal:close', execId)).toEqual({ ok: true, value: undefined });
    expect(ports[1]?.closed).toBe(true);
    expect(core.host.kills).toEqual([]);
    core.host.output(execId, 'x');
    expect(ports[1]?.sent.at(-1)).not.toMatchObject({ type: 'data', offset: 0 });
  });

  it('validates the execution id', async () => {
    const { rec } = await setup();
    expect((await rec.call('terminal:open', '../x')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('terminal:open', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
  });
});
