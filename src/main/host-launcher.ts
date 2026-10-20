import { parseEndpointFile } from '../core/contracts/endpoint';
import { MelinnaError } from '../core/errors';
import type { HostProvider } from '../core/execution/context';
import type { AppPaths } from '../core/paths';
import type { HostClient } from '../core/ports/host-client';
import type { Logger } from '../core/ports/logger';

export const HOST_START_TIMEOUT_MS = 5000;

export interface ConnectedHost extends HostClient {
  isConnected(): boolean;
}

export interface SpawnedProcess {
  pid?: number | undefined;
  unref(): void;
}

export interface HostLauncherDeps {
  paths: AppPaths;
  log: Logger;
  /** Binário do Electron (`process.execPath`). */
  execPath: string;
  /** `out/host/main.js`. */
  hostScript: string;
  baseEnv: Record<string, string>;
  spawnDetached(file: string, args: string[], env: Record<string, string>): SpawnedProcess;
  connect(endpoint: string, token: string): Promise<ConnectedHost>;
  readText(path: string): string | null;
  ensureToken(path: string): string;
  isPidAlive(pid: number): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
  startTimeoutMs?: number;
}

/**
 * Fornece o hospedeiro de PTY: reaproveita um hospedeiro vivo (arquivo `endpoint` + `welcome`) ou inicia um novo,
 * destacado, com `ELECTRON_RUN_AS_NODE=1`. Após uma queda, o próximo pedido inicia outro.
 */
export class HostLauncher implements HostProvider {
  private client: ConnectedHost | null = null;
  private inflight: Promise<ConnectedHost> | null = null;

  constructor(private readonly deps: HostLauncherDeps) {}

  current(): ConnectedHost | null {
    return this.client?.isConnected() ? this.client : null;
  }

  async existing(): Promise<HostClient | null> {
    const live = this.current();
    if (live) return live;
    const found = await this.connectToRunning().catch((err: unknown) => {
      this.deps.log.warn('host.existing_failed', {
        code: err instanceof MelinnaError ? err.code : 'unknown',
      });
      return null;
    });
    if (found) this.client = found;
    return found;
  }

  get(): Promise<HostClient> {
    const live = this.current();
    if (live) return Promise.resolve(live);
    this.inflight ??= this.obtain().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async obtain(): Promise<ConnectedHost> {
    const running = await this.connectToRunning().catch(() => null);
    if (running) {
      this.client = running;
      return running;
    }
    this.client = await this.start();
    return this.client;
  }

  private async connectToRunning(): Promise<ConnectedHost | null> {
    const text = this.deps.readText(this.deps.paths.hostEndpoint);
    const endpoint = text ? parseEndpointFile(text) : null;
    if (!endpoint || !this.deps.isPidAlive(endpoint.pid)) return null;
    const token = this.deps.ensureToken(this.deps.paths.hostToken);
    const client = await this.deps.connect(endpoint.path, token);
    this.deps.log.info('host.reused', { hostPid: endpoint.pid });
    return client;
  }

  private async start(): Promise<ConnectedHost> {
    const { deps } = this;
    deps.ensureToken(deps.paths.hostToken);
    const before = deps.readText(deps.paths.hostEndpoint);
    const child = deps.spawnDetached(deps.execPath, [deps.hostScript], {
      ...deps.baseEnv,
      ELECTRON_RUN_AS_NODE: '1',
      MELINNA_USER_DATA: deps.paths.userData,
    });
    child.unref();
    deps.log.info('host.starting', { hostPid: child.pid ?? null });
    const deadline = deps.now() + (deps.startTimeoutMs ?? HOST_START_TIMEOUT_MS);
    while (deps.now() < deadline) {
      await deps.sleep(100);
      const text = deps.readText(deps.paths.hostEndpoint);
      const endpoint = text && text !== before ? parseEndpointFile(text) : null;
      if (!endpoint || (child.pid !== undefined && endpoint.pid !== child.pid)) continue;
      try {
        return await deps.connect(endpoint.path, deps.ensureToken(deps.paths.hostToken));
      } catch (err) {
        if (err instanceof MelinnaError && (err.code === 'HOST_AUTH' || err.code === 'HOST_VERSION'))
          throw err;
      }
    }
    deps.log.error('host.start_timeout');
    throw new MelinnaError('HOST_UNAVAILABLE', {
      userMessage: 'O hospedeiro de terminais não respondeu em 5 segundos.',
    });
  }
}
