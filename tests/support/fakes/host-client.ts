import { MelinnaError } from '../../../src/core/errors';
import type {
  ActivityEvent,
  Detach,
  ExitEvent,
  HostClient,
  HostProcessInfo,
  OutputSink,
  ScrollbackStatusEvent,
  SpawnRequest,
  Unsubscribe,
} from '../../../src/core/ports/host-client';

interface FakeProc {
  req: SpawnRequest;
  pid: number;
  alive: boolean;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  endedAt: string | null;
  history: Uint8Array[];
  totalBytes: number;
  sinks: Set<OutputSink>;
}

type Listener = (e: never) => void;

/** Hospedeiro em memória: registra chamadas e permite simular saída, término e queda. */
export class FakeHostClient implements HostClient {
  readonly spawns: SpawnRequest[] = [];
  readonly writes: { execId: string; data: string }[] = [];
  readonly resizes: { execId: string; cols: number; rows: number }[] = [];
  readonly kills: string[] = [];
  readonly acks: { execId: string; offset: number }[] = [];
  readonly procs = new Map<string, FakeProc>();
  spawnFailure: ((req: SpawnRequest) => MelinnaError | undefined) | undefined;
  shutdownCalls: number[] = [];
  private nextPid = 1000;
  private listeners = new Map<string, Set<Listener>>();

  async spawn(req: SpawnRequest): Promise<{ pid: number }> {
    this.spawns.push(req);
    const failure = this.spawnFailure?.(req);
    if (failure) throw failure;
    const prev = this.procs.get(req.execId);
    const pid = this.nextPid++;
    this.procs.set(req.execId, {
      req,
      pid,
      alive: true,
      exitCode: null,
      signal: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      history: prev?.history ?? [],
      totalBytes: prev?.totalBytes ?? 0,
      sinks: prev?.sinks ?? new Set(),
    });
    return { pid };
  }

  write(execId: string, data: Uint8Array): void {
    this.writes.push({ execId, data: new TextDecoder().decode(data) });
  }

  resize(execId: string, cols: number, rows: number): void {
    this.resizes.push({ execId, cols, rows });
  }

  async kill(execId: string, _opts: { graceMs: number }): Promise<void> {
    this.kills.push(execId);
    const p = this.procs.get(execId);
    if (!p || !p.alive) throw new MelinnaError('EXECUTION_NOT_RUNNING');
    this.exit(execId, 0, null);
  }

  async attach(execId: string, fromOffset: number, sink: OutputSink): Promise<Detach> {
    const p = this.procs.get(execId);
    if (!p) throw new MelinnaError('EXECUTION_NOT_RUNNING');
    sink.onMarker('replay-start');
    let offset = 0;
    for (const chunk of p.history) {
      if (offset + chunk.length > fromOffset) {
        const start = Math.max(0, fromOffset - offset);
        sink.onData(offset + start, chunk.subarray(start));
      }
      offset += chunk.length;
    }
    sink.onMarker('replay-end');
    p.sinks.add(sink);
    return async () => {
      p.sinks.delete(sink);
    };
  }

  ack(execId: string, offset: number): void {
    this.acks.push({ execId, offset });
  }

  async list(): Promise<HostProcessInfo[]> {
    return [...this.procs.entries()].map(([execId, p]) => ({
      execId,
      pid: p.pid,
      alive: p.alive,
      exitCode: p.exitCode,
      signal: p.signal,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      totalBytes: p.totalBytes,
    }));
  }

  async shutdown(graceMs: number): Promise<void> {
    this.shutdownCalls.push(graceMs);
    for (const [execId, p] of this.procs) if (p.alive) this.exit(execId, null, 'SIGTERM');
  }

  on(event: 'exit', fn: (e: ExitEvent) => void): Unsubscribe;
  on(event: 'activity', fn: (e: ActivityEvent) => void): Unsubscribe;
  on(event: 'scrollback-status', fn: (e: ScrollbackStatusEvent) => void): Unsubscribe;
  on(event: 'disconnected', fn: () => void): Unsubscribe;
  on(event: string, fn: Listener): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  private emit(event: string, payload?: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as (e: unknown) => void)(payload);
  }

  // Simulação
  output(execId: string, text: string | Uint8Array): void {
    const p = this.procs.get(execId);
    if (!p) throw new Error(`no proc ${execId}`);
    const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
    const offset = p.totalBytes;
    p.history.push(bytes);
    p.totalBytes += bytes.length;
    for (const s of p.sinks) s.onData(offset, bytes);
    this.emit('activity', { execId, lastOutputAt: new Date().toISOString() });
  }

  exit(execId: string, exitCode: number | null, signal: string | null = null): void {
    const p = this.procs.get(execId);
    if (!p) throw new Error(`no proc ${execId}`);
    p.alive = false;
    p.exitCode = exitCode;
    p.signal = signal;
    p.endedAt = new Date().toISOString();
    this.emit('exit', { execId, exitCode, signal, endedAt: p.endedAt });
  }

  scrollbackStatus(e: ScrollbackStatusEvent): void {
    this.emit('scrollback-status', e);
  }

  disconnect(): void {
    this.emit('disconnected');
  }

  writesFor(execId: string): string {
    return this.writes
      .filter((w) => w.execId === execId)
      .map((w) => w.data)
      .join('');
  }
}
