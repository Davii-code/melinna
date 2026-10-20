import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import { FrameDecoder, encodeFrame } from '../core/contracts/frame-codec';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
  type HostMessage,
  type MarkerKind,
  type SpawnRequest,
} from '../core/contracts/host-protocol';
import { MelinnaError, isMelinnaError } from '../core/errors';
import type { Cancel, Clock } from '../core/ports/clock';
import type { Logger } from '../core/ports/logger';
import { tokensEqual } from './auth';
import type { PtySupervisor, Subscriber } from './pty-supervisor';

export const HELLO_TIMEOUT_MS = 2000;

export interface HostServerDeps {
  supervisor: PtySupervisor;
  token: string;
  log: Logger;
  clock: Clock;
  hostPid: number;
  onConnectionsChanged: () => void;
  onShutdown: () => void;
}

class Connection implements Subscriber {
  private readonly decoder = new FrameDecoder();
  authed = false;
  private helloTimer: Cancel | undefined;
  private closed = false;
  private ending = false;

  constructor(
    private readonly socket: Socket,
    private readonly server: HostServer,
    private readonly deps: HostServerDeps,
  ) {
    this.helloTimer = deps.clock.setTimeout(() => {
      if (!this.authed) this.close();
    }, HELLO_TIMEOUT_MS);
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
  }

  send(header: HostMessage, payload?: Uint8Array): void {
    if (this.closed) return;
    try {
      this.socket.write(encodeFrame(header, payload));
    } catch (err) {
      this.deps.log.warn('host.send_failed', { code: isMelinnaError(err) ? err.code : 'unknown' });
    }
  }

  output(execId: string, offset: number, bytes: Uint8Array): void {
    this.send({ t: 'output', execId, offset }, bytes);
  }

  marker(execId: string, kind: MarkerKind, lostBytes?: number): void {
    this.send(
      lostBytes === undefined ? { t: 'marker', execId, kind } : { t: 'marker', execId, kind, lostBytes },
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.helloTimer?.();
    this.deps.supervisor.detachAll(this);
    this.socket.destroy();
    this.server.forget(this);
  }

  /** Envia o erro, encerra a escrita e descarta o resto da conexão; o fechamento termina em `close`. */
  private fail(code: MelinnaError['code'], message: string, extra: Partial<HostMessage> = {}): void {
    this.send({ t: 'error', code, message, ...extra } as HostMessage);
    this.authed = false;
    this.ending = true;
    this.deps.supervisor.detachAll(this);
    this.socket.end();
    this.deps.clock.setTimeout(() => this.close(), 1000);
  }

  private onData(chunk: Buffer): void {
    if (this.ending) return;
    let frames;
    try {
      frames = this.decoder.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    } catch {
      this.fail('HOST_PROTOCOL', 'quadro inválido');
      return;
    }
    for (const frame of frames) {
      if (this.closed || this.ending) return;
      let msg: ClientMessage;
      try {
        msg = parseClientMessage(frame.header);
      } catch {
        this.fail('HOST_PROTOCOL', 'mensagem inválida');
        return;
      }
      if (!this.authed) {
        this.handshake(msg);
        continue;
      }
      void this.dispatch(msg, frame.payload);
    }
  }

  private handshake(msg: ClientMessage): void {
    if (msg.t !== 'hello') {
      this.fail('HOST_AUTH', 'handshake ausente');
      return;
    }
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.fail('HOST_VERSION', 'versão de protocolo diferente', {
        supported: PROTOCOL_VERSION,
      } as Partial<HostMessage>);
      return;
    }
    if (!tokensEqual(this.deps.token, msg.token)) {
      this.deps.log.warn('host.auth_failed');
      this.fail('HOST_AUTH', 'segredo inválido');
      return;
    }
    this.authed = true;
    this.helloTimer?.();
    this.helloTimer = undefined;
    this.send({ t: 'welcome', protocolVersion: PROTOCOL_VERSION, hostPid: this.deps.hostPid });
    this.deps.onConnectionsChanged();
  }

  private async dispatch(msg: ClientMessage, payload: Uint8Array): Promise<void> {
    const sup = this.deps.supervisor;
    const reply = async (id: number, fn: () => Promise<unknown> | unknown) => {
      try {
        const result = await fn();
        this.send(result === undefined ? { t: 'ok', id } : { t: 'ok', id, result });
      } catch (err) {
        const code = isMelinnaError(err) ? err.code : 'INTERNAL';
        const message = isMelinnaError(err) ? err.userMessage : 'erro interno do hospedeiro';
        if (!isMelinnaError(err)) this.deps.log.error('host.request_failed', { t: msg.t, err });
        this.send({ t: 'error', id, code, message });
      }
    };
    switch (msg.t) {
      case 'hello':
        return;
      case 'spawn': {
        const req: SpawnRequest = {
          execId: msg.execId,
          file: msg.file,
          args: msg.args,
          cwd: msg.cwd,
          env: msg.env,
          cols: msg.cols,
          rows: msg.rows,
        };
        if (msg.separator !== undefined) req.separator = msg.separator;
        await reply(msg.id, () => sup.spawn(req));
        this.deps.onConnectionsChanged();
        return;
      }
      case 'write':
        try {
          sup.write(msg.execId, payload);
        } catch (err) {
          const code = isMelinnaError(err) ? err.code : 'INTERNAL';
          this.send({ t: 'error', execId: msg.execId, code, message: 'escrita recusada' });
        }
        return;
      case 'ack':
        sup.ack(msg.execId, this, msg.offset);
        return;
      case 'resize':
        sup.resize(msg.execId, msg.cols, msg.rows);
        return;
      case 'kill':
        await reply(msg.id, () => sup.kill(msg.execId, msg.graceMs));
        return;
      case 'attach':
        await reply(msg.id, () => sup.attach(msg.execId, msg.fromOffset, this));
        return;
      case 'detach':
        await reply(msg.id, () => sup.detach(msg.execId, this));
        return;
      case 'list':
        await reply(msg.id, () => ({ processes: sup.list() }));
        return;
      case 'shutdown':
        await reply(msg.id, () => sup.shutdown(msg.graceMs));
        this.deps.onShutdown();
        return;
    }
  }
}

export class HostServer {
  private server: Server | undefined;
  private readonly connections = new Set<Connection>();

  constructor(private readonly deps: HostServerDeps) {}

  connectionCount(): number {
    let n = 0;
    for (const c of this.connections) if (c.authed) n++;
    return n;
  }

  /** Envia um evento a todas as conexões autenticadas. */
  broadcast(msg: HostMessage): void {
    for (const c of this.connections) if (c.authed) c.send(msg);
  }

  forget(conn: Connection): void {
    if (this.connections.delete(conn)) this.deps.onConnectionsChanged();
  }

  async listen(endpoint: string): Promise<void> {
    if (process.platform !== 'win32') await prepareSocketPath(endpoint);
    const server = createServer((socket) => {
      this.connections.add(new Connection(socket, this, this.deps));
      this.deps.onConnectionsChanged();
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    if (process.platform !== 'win32') chmodSync(endpoint, 0o600);
  }

  async close(): Promise<void> {
    for (const c of [...this.connections]) c.close();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

/** No POSIX: diretório `0700` e remoção de socket órfão (sem hospedeiro escutando). */
async function prepareSocketPath(endpoint: string): Promise<void> {
  mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
  chmodSync(dirname(endpoint), 0o700);
  if (!existsSync(endpoint)) return;
  const alive = await new Promise<boolean>((resolve) => {
    const s = createConnection(endpoint);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
  if (alive)
    throw new MelinnaError('HOST_UNAVAILABLE', {
      userMessage: 'Já há um hospedeiro escutando neste endereço.',
    });
  unlinkSync(endpoint);
}
