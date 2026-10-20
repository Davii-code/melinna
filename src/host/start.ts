import { mkdirSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { NodeClock } from '../adapters/node-clock';
import { NodeFileSystem } from '../adapters/node-fs';
import { hostEndpointPath } from '../core/contracts/endpoint';
import { PROTOCOL_VERSION } from '../core/contracts/host-protocol';
import { JsonlSink } from '../core/log/jsonl-sink';
import { createLogger } from '../core/log/logger';
import { makePaths } from '../core/paths';
import type { Clock } from '../core/ports/clock';
import type { Logger } from '../core/ports/logger';
import type { OsName } from '../core/ports/platform';
import { readToken } from './auth';
import { IdleExit } from './idle-exit';
import { NodePtyFactory, type PtyFactory } from './node-pty-adapter';
import { PtySupervisor } from './pty-supervisor';
import { HostRegistry } from './registry';
import { HostServer } from './server';

export interface StartHostOptions {
  userData: string;
  /** Chamado quando o hospedeiro deve sair (ocioso ou `shutdown`). */
  onExit: (code: number) => void;
  clock?: Clock;
  log?: Logger;
  ptyFactory?: PtyFactory;
  idleExitMs?: number;
}

export interface RunningHost {
  endpoint: string;
  supervisor: PtySupervisor;
  server: HostServer;
  stop(): Promise<void>;
}

export function currentOs(): OsName {
  return process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
}

export async function startHost(opts: StartHostOptions): Promise<RunningHost> {
  const os = currentOs();
  const paths = makePaths(opts.userData, os);
  mkdirSync(paths.logsDir, { recursive: true });
  mkdirSync(paths.hostDir, { recursive: true, mode: 0o700 });
  const fs = new NodeFileSystem();
  const clock = opts.clock ?? new NodeClock();
  const sink = new JsonlSink(fs, paths.hostLog);
  const log = opts.log ?? createLogger({ sink, clock, component: 'host' });

  const token = readToken(paths.hostToken);
  const registry = new HostRegistry(fs, paths.hostRegistry, log.child('registry'));
  await registry.load();

  const ref: { server?: HostServer; idle?: IdleExit } = {};
  const supervisor = new PtySupervisor({
    ptyFactory: opts.ptyFactory ?? new NodePtyFactory(),
    fs,
    paths,
    clock,
    log: log.child('pty'),
    registry,
    events: {
      exit: (e) => ref.server?.broadcast({ t: 'exit', ...e }),
      activity: (e) => ref.server?.broadcast({ t: 'activity', ...e }),
      scrollbackStatus: (e) => ref.server?.broadcast({ t: 'scrollback-status', ...e }),
      changed: () => ref.idle?.evaluate(),
    },
  });

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    ref.idle?.stop();
    await ref.server?.close();
    await sink.flush();
  };
  const exit = (code: number) => {
    void stop().then(() => opts.onExit(code));
  };

  const server = new HostServer({
    supervisor,
    token,
    log: log.child('server'),
    clock,
    hostPid: process.pid,
    onConnectionsChanged: () => ref.idle?.touch(),
    onShutdown: () => exit(0),
  });
  ref.server = server;
  ref.idle = new IdleExit(
    clock,
    () => ({ alive: supervisor.aliveCount(), connections: server.connectionCount() }),
    () => {
      log.info('host.idle_exit');
      exit(0);
    },
    opts.idleExitMs,
  );

  const endpoint = hostEndpointPath(paths, os, userInfo().username);
  await server.listen(endpoint);
  writeFileSync(
    paths.hostEndpoint,
    JSON.stringify({ path: endpoint, pid: process.pid, protocolVersion: PROTOCOL_VERSION }),
  );
  log.info('host.listening', { pid: process.pid });
  ref.idle.evaluate();
  return { endpoint, supervisor, server, stop };
}
