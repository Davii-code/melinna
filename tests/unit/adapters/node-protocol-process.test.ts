import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
const launch = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: launch }));
import { NodeProtocolProcessFactory } from '../../../src/adapters/node-protocol-process';

describe('NodeProtocolProcessFactory', () => {
  it('spawns argv without shell and delivers data/exit with cleanup', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
      pid: undefined,
    });
    launch.mockImplementationOnce(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    const process = await new NodeProtocolProcessFactory(async () => '/bin/tool').start({
      protocol: 'lsp',
      root: '/repo',
      executable: 'tool',
      args: ['--stdio'],
    });
    expect(launch).toHaveBeenCalledWith(
      '/bin/tool',
      ['--stdio'],
      expect.objectContaining({ shell: false, cwd: '/repo', windowsHide: true }),
    );
    const receive = vi.fn();
    const ended = vi.fn();
    const off = process.onData(receive);
    process.onExit(ended);
    child.stdout.write(Buffer.from('data'));
    expect(receive).toHaveBeenCalledOnce();
    off();
    child.stdout.write(Buffer.from('more'));
    expect(receive).toHaveBeenCalledOnce();
    child.emit('close');
    expect(ended).toHaveBeenCalledOnce();
  });
  it('rejects shell launchers before starting a process', async () => {
    await expect(
      new NodeProtocolProcessFactory(async () => '/tool.cmd').start({
        protocol: 'lsp',
        root: '/repo',
        executable: 'tool.cmd',
        args: [],
      }),
    ).rejects.toThrow();
  });
});
