import type { HostProcessInfo, MarkerKind, SpawnRequest } from '../contracts/host-protocol';

export type { HostProcessInfo, MarkerKind, SpawnRequest };

export type Unsubscribe = () => void;
export type Detach = () => Promise<void>;

export interface OutputSink {
  onData(offset: number, bytes: Uint8Array): void;
  onMarker(kind: MarkerKind, lostBytes?: number): void;
}

export interface ExitEvent {
  execId: string;
  exitCode: number | null;
  signal: string | null;
  endedAt: string;
}

export interface ActivityEvent {
  execId: string;
  lastOutputAt: string;
}

export interface ScrollbackStatusEvent {
  execId: string;
  persisting: boolean;
  reason?: 'DISK_FULL' | 'IO_ERROR';
}

export interface HostClient {
  spawn(req: SpawnRequest): Promise<{ pid: number }>;
  write(execId: string, data: Uint8Array): void;
  resize(execId: string, cols: number, rows: number): void;
  kill(execId: string, opts: { graceMs: number }): Promise<void>;
  attach(execId: string, fromOffset: number, sink: OutputSink): Promise<Detach>;
  /** Controle de fluxo: último deslocamento processado pelo consumidor. */
  ack(execId: string, offset: number): void;
  list(): Promise<HostProcessInfo[]>;
  shutdown(graceMs: number): Promise<void>;
  on(event: 'exit', fn: (e: ExitEvent) => void): Unsubscribe;
  on(event: 'activity', fn: (e: ActivityEvent) => void): Unsubscribe;
  on(event: 'scrollback-status', fn: (e: ScrollbackStatusEvent) => void): Unsubscribe;
  on(event: 'disconnected', fn: () => void): Unsubscribe;
}
