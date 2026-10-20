import { createConnection, type Socket } from 'node:net';
import { FrameDecoder, encodeFrame } from '../core/contracts/frame-codec';
import {
  PROTOCOL_VERSION,
  parseHostMessage,
  type AttachResult,
  type HostMessage,
  type HostProcessInfo,
  type SpawnRequest,
} from '../core/contracts/host-protocol';
import { ERROR_CODES, MelinnaError, type ErrorCode } from '../core/errors';
import type {
  ActivityEvent,
  Detach,
  ExitEvent,
  HostClient,
  OutputSink,
  ScrollbackStatusEvent,
  Unsubscribe,
} from '../core/ports/host-client';
import type { Logger } from '../core/ports/logger';

const MAX_WRITE_CHUNK = 512 * 1024;

function asCode(code: unknown): ErrorCode {
  return ERROR_CODES.includes(code as ErrorCode) ? (code as ErrorCode) : 'HOST_PROTOCOL';
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: MelinnaError) => void;
}

type EventName = 'exit' | 'activity' | 'scrollback-status' | 'disconnected';

/** Cliente do hospedeiro sobre pipe nomeado / socket Unix, com o protocolo de quadros. */
export class NodeHostClient implements HostClient {
  private readonly decoder = new FrameDecoder();
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly sinks = new Map<string, Set<OutputSink>>();
  private readonly listeners = new Map<EventName, Set<(e: never) => void>>();
  private connected = true;
  hostPid = 0;

  private constructor(
    private readonly socket: Socket,
    private readonly log: Logger,
  ) {}

  /** Conecta e faz o handshake. Falhas: HOST_UNAVAILABLE, HOST_AUTH, HOST_VERSION. */
  static connect(endpoint: string, token: string, log: Logger, timeoutMs = 2000): Promise<NodeHostClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(endpoint);
      const client = new NodeHostClient(socket, log);
      let settled = false;
      const done = (err: MelinnaError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          socket.destroy();
          reject(err);
        } else {
          resolve(client);
        }
      };
      const timer = setTimeout(
        () => done(new MelinnaError('HOST_UNAVAILABLE', { details: { reason: 'sem welcome' } })),
        timeoutMs,
      );
      socket.once('connect', () => {
        socket.write(encodeFrame({ t: 'hello', protocolVersion: PROTOCOL_VERSION, token }));
      });
      socket.on('error', (cause) => done(new MelinnaError('HOST_UNAVAILABLE', { cause })));
      socket.on('close', () => {
        done(new MelinnaError('HOST_UNAVAILABLE', { details: { reason: 'conexão fechada' } }));
        client.onClose();
      });
      socket.on('data', (chunk: Buffer) => {
        let frames;
        try {
          frames = client.decoder.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        } catch (err) {
          log.error('host_client.protocol', { err });
          socket.destroy();
          return;
        }
        for (const f of frames) {
          let msg: HostMessage;
          try {
            msg = parseHostMessage(f.header);
          } catch {
            continue;
          }
          if (!settled) {
            if (msg.t === 'welcome') {
              client.hostPid = msg.hostPid;
              done(null);
            } else if (msg.t === 'error') {
              const details: Record<string, number> = {};
              if (msg.supported !== undefined) details.supported = msg.supported;
              done(new MelinnaError(asCode(msg.code), { details }));
            }
            continue;
          }
          client.onMessage(msg, f.payload);
        }
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    this.socket.end();
  }

  async spawn(req: SpawnRequest): Promise<{ pid: number }> {
    return (await this.request({ t: 'spawn', ...req })) as { pid: number };
  }

  write(execId: string, data: Uint8Array): void {
    for (let i = 0; i < data.length; i += MAX_WRITE_CHUNK) {
      this.send({ t: 'write', execId }, data.subarray(i, i + MAX_WRITE_CHUNK));
    }
  }

  resize(execId: string, cols: number, rows: number): void {
    this.send({ t: 'resize', execId, cols, rows });
  }

  async kill(execId: string, opts: { graceMs: number }): Promise<void> {
    await this.request({ t: 'kill', execId, graceMs: opts.graceMs });
  }

  async attach(execId: string, fromOffset: number, sink: OutputSink): Promise<Detach> {
    let set = this.sinks.get(execId);
    if (!set) {
      set = new Set();
      this.sinks.set(execId, set);
    }
    set.add(sink);
    try {
      (await this.request({ t: 'attach', execId, fromOffset })) as AttachResult;
    } catch (err) {
      set.delete(sink);
      throw err;
    }
    return async () => {
      set.delete(sink);
      if (set.size === 0 && this.connected)
        await this.request({ t: 'detach', execId }).catch(() => undefined);
    };
  }

  ack(execId: string, offset: number): void {
    this.send({ t: 'ack', execId, offset });
  }

  async list(): Promise<HostProcessInfo[]> {
    return ((await this.request({ t: 'list' })) as { processes: HostProcessInfo[] }).processes;
  }

  async shutdown(graceMs: number): Promise<void> {
    await this.request({ t: 'shutdown', graceMs }, 60_000);
  }

  on(event: 'exit', fn: (e: ExitEvent) => void): Unsubscribe;
  on(event: 'activity', fn: (e: ActivityEvent) => void): Unsubscribe;
  on(event: 'scrollback-status', fn: (e: ScrollbackStatusEvent) => void): Unsubscribe;
  on(event: 'disconnected', fn: () => void): Unsubscribe;
  on(event: EventName, fn: (e: never) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit(event: EventName, payload?: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        (fn as (e: unknown) => void)(payload);
      } catch (err) {
        this.log.error('host_client.listener_failed', { event, err });
      }
    }
  }

  private send(header: object, payload?: Uint8Array): void {
    if (!this.connected) return;
    this.socket.write(encodeFrame(header, payload));
  }

  private request(header: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (!this.connected) return Promise.reject(new MelinnaError('HOST_UNAVAILABLE'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new MelinnaError('HOST_UNAVAILABLE', { details: { reason: 'sem resposta', t: String(header.t) } }),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.send({ ...header, id });
    });
  }

  private onMessage(msg: HostMessage, payload: Uint8Array): void {
    switch (msg.t) {
      case 'ok':
        this.pending.get(msg.id)?.resolve(msg.result);
        this.pending.delete(msg.id);
        return;
      case 'error':
        if (msg.id !== undefined) {
          this.pending.get(msg.id)?.reject(new MelinnaError(asCode(msg.code), { userMessage: msg.message }));
          this.pending.delete(msg.id);
        } else {
          this.log.warn('host_client.async_error', { code: msg.code, execId: msg.execId });
        }
        return;
      case 'output':
        for (const s of this.sinks.get(msg.execId) ?? []) s.onData(msg.offset, payload);
        return;
      case 'marker':
        for (const s of this.sinks.get(msg.execId) ?? []) s.onMarker(msg.kind, msg.lostBytes);
        return;
      case 'exit':
        this.emit('exit', {
          execId: msg.execId,
          exitCode: msg.exitCode,
          signal: msg.signal,
          endedAt: msg.endedAt,
        });
        return;
      case 'activity':
        this.emit('activity', { execId: msg.execId, lastOutputAt: msg.lastOutputAt });
        return;
      case 'scrollback-status': {
        const e: ScrollbackStatusEvent = { execId: msg.execId, persisting: msg.persisting };
        if (msg.reason) e.reason = msg.reason;
        this.emit('scrollback-status', e);
        return;
      }
      case 'welcome':
        return;
    }
  }

  private onClose(): void {
    if (!this.connected) return;
    this.connected = false;
    for (const p of this.pending.values())
      p.reject(new MelinnaError('HOST_UNAVAILABLE', { details: { reason: 'conexão perdida' } }));
    this.pending.clear();
    this.emit('disconnected');
  }
}
