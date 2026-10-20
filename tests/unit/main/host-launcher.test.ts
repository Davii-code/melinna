import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../src/core/errors';
import { makePaths } from '../../../src/core/paths';
import { HostLauncher, type ConnectedHost, type HostLauncherDeps } from '../../../src/main/host-launcher';
import { FakeHostClient } from '../../support/fakes/host-client';
import { MemoryLogger } from '../../support/fakes/logger';

class ConnectedFake extends FakeHostClient implements ConnectedHost {
  connected = true;
  isConnected(): boolean {
    return this.connected;
  }
}

function setup(over: Partial<HostLauncherDeps> = {}) {
  const files = new Map<string, string>();
  const paths = makePaths('/data', 'linux');
  const spawned: { file: string; args: string[]; env: Record<string, string>; unref: boolean }[] = [];
  const connects: string[] = [];
  const alive = new Set<number>();
  let clock = 0;
  let nextPid = 4242;
  const deps: HostLauncherDeps = {
    paths,
    log: new MemoryLogger(),
    execPath: '/opt/electron',
    hostScript: '/app/out/host/main.js',
    baseEnv: { PATH: '/bin' },
    spawnDetached: (file, args, env) => {
      const rec = { file, args, env, unref: false };
      spawned.push(rec);
      const pid = nextPid++;
      alive.add(pid);
      files.set(paths.hostEndpoint, JSON.stringify({ path: '/data/host/sock', pid, protocolVersion: 1 }));
      return { pid, unref: () => (rec.unref = true) };
    },
    connect: async (endpoint) => {
      connects.push(endpoint);
      return new ConnectedFake();
    },
    readText: (p) => files.get(p) ?? null,
    ensureToken: () => 'a'.repeat(64),
    isPidAlive: (pid) => alive.has(pid),
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    ...over,
  };
  return { deps, files, paths, spawned, connects, alive, launcher: new HostLauncher(deps) };
}

describe('HostLauncher', () => {
  it('reuses a host whose endpoint pid is alive and answers welcome', async () => {
    const { launcher, files, paths, alive, spawned, connects } = setup();
    files.set(paths.hostEndpoint, JSON.stringify({ path: '/data/host/sock', pid: 99, protocolVersion: 1 }));
    alive.add(99);
    const client = await launcher.get();
    expect(client).toBeInstanceOf(ConnectedFake);
    expect(spawned).toEqual([]);
    expect(connects).toEqual(['/data/host/sock']);
    expect(await launcher.get()).toBe(client);
  });

  it('starts a new detached host when the endpoint pid is dead', async () => {
    const { launcher, files, paths, spawned } = setup();
    files.set(paths.hostEndpoint, JSON.stringify({ path: '/data/host/sock', pid: 1, protocolVersion: 1 }));
    await launcher.get();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]).toMatchObject({ file: '/opt/electron', args: ['/app/out/host/main.js'], unref: true });
    expect(spawned[0]?.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      MELINNA_USER_DATA: '/data',
      PATH: '/bin',
    });
  });

  it('existing() never starts a host', async () => {
    const { launcher, spawned } = setup();
    expect(await launcher.existing()).toBeNull();
    expect(spawned).toEqual([]);
  });

  it('fails with HOST_UNAVAILABLE without welcome within 5 s', async () => {
    const { launcher } = setup({
      connect: async () => {
        throw new MelinnaError('HOST_UNAVAILABLE');
      },
    });
    await expect(launcher.get()).rejects.toMatchObject({ code: 'HOST_UNAVAILABLE' });
  });

  it('starts a new host on demand after the connection drops', async () => {
    const { launcher, spawned, alive } = setup();
    const first = (await launcher.get()) as ConnectedFake;
    first.connected = false;
    alive.clear();
    const second = await launcher.get();
    expect(second).not.toBe(first);
    expect(spawned).toHaveLength(2);
  });

  it('shares one start between concurrent callers', async () => {
    const { launcher, spawned } = setup();
    const [a, b] = await Promise.all([launcher.get(), launcher.get()]);
    expect(a).toBe(b);
    expect(spawned).toHaveLength(1);
  });
});
