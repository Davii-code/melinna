import { describe, expect, it } from 'vitest';
import type { MarkerKind } from '../../../src/core/ports/host-client';
import { FakeHostClient } from '../../support/fakes/host-client';

const req = { execId: 'e1', file: '/bin/a', args: [], cwd: '/w', env: {}, cols: 80, rows: 24 };

describe('FakeHostClient', () => {
  it('replays history between markers then streams live output', async () => {
    const host = new FakeHostClient();
    await host.spawn(req);
    host.output('e1', 'abc');
    const got: string[] = [];
    const detach = await host.attach('e1', 1, {
      onData: (offset, bytes) => got.push(`${offset}:${new TextDecoder().decode(bytes)}`),
      onMarker: (kind: MarkerKind) => got.push(kind),
    });
    host.output('e1', 'de');
    await detach();
    host.output('e1', 'f');
    expect(got).toEqual(['replay-start', '1:bc', 'replay-end', '3:de']);
  });

  it('emits exit, activity and disconnected; kill of dead exec fails', async () => {
    const host = new FakeHostClient();
    const events: string[] = [];
    host.on('exit', (e) => events.push(`exit:${e.exitCode}`));
    host.on('activity', () => events.push('activity'));
    host.on('disconnected', () => events.push('disc'));
    await host.spawn(req);
    host.output('e1', 'x');
    await host.kill('e1', { graceMs: 1 });
    await expect(host.kill('e1', { graceMs: 1 })).rejects.toMatchObject({ code: 'EXECUTION_NOT_RUNNING' });
    host.disconnect();
    host.ack('e1', 1);
    expect(events).toEqual(['activity', 'exit:0', 'disc']);
    expect((await host.list())[0]).toMatchObject({ execId: 'e1', alive: false, totalBytes: 1 });
    expect(host.acks).toEqual([{ execId: 'e1', offset: 1 }]);
  });
});
