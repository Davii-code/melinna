import type { Cancel, Clock } from '../ports/clock';
import { errorCode } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import { mergeReplay } from './scrollback-reader';
import type { ReplayItem, SegmentStore } from './segment-store';

export const MAX_PENDING_BYTES = 4 * 1024 * 1024;
export const RETRY_MS = 30_000;
const BATCH_BYTES = 1024 * 1024;

export interface PendingChunk {
  offset: number;
  bytes: Uint8Array;
}

export type PersistStatus = { persisting: true } | { persisting: false; reason: 'DISK_FULL' | 'IO_ERROR' };

/**
 * Fila entre o PTY e o disco: `push` nunca bloqueia nem lança. Acima de 4 MB pendentes descarta o mais antigo
 * (vira lacuna no histórico). Com disco cheio, para de gravar, avisa e tenta de novo a cada 30 s.
 */
export class ScrollbackWriter {
  private queue: PendingChunk[] = [];
  private queued = 0;
  private persisting = true;
  private draining: Promise<void> | null = null;
  private retryCancel: Cancel | undefined;
  private dropped = false;
  private closed = false;
  private holds = 0;
  private reportedDown = false;

  constructor(
    private readonly store: SegmentStore,
    private readonly clock: Clock,
    private readonly log: Logger,
    private readonly onStatus: (s: PersistStatus) => void,
    private readonly maxPending = MAX_PENDING_BYTES,
    private readonly retryMs = RETRY_MS,
  ) {}

  isPersisting(): boolean {
    return this.persisting;
  }

  push(offset: number, bytes: Uint8Array): void {
    if (this.closed || bytes.length === 0) return;
    this.queue.push({ offset, bytes });
    this.queued += bytes.length;
    while (this.queued > this.maxPending && this.queue.length > 1) {
      const old = this.queue.shift();
      if (old) this.queued -= old.bytes.length;
      this.dropped = true;
    }
    if (this.persisting) this.kick();
  }

  /** Bytes ainda não gravados, em ordem. */
  pending(): PendingChunk[] {
    return [...this.queue];
  }

  /**
   * Reprodução consistente a partir de `fromOffset`: suspende a gravação, lê o disco e a fila, e retoma.
   * Bytes empurrados depois deste instante têm deslocamento ≥ `endOffset`.
   */
  async replayFrom(
    fromOffset: number,
  ): Promise<{ items: ReplayItem[]; endOffset: number; firstAvailableOffset: number }> {
    await this.flush();
    this.holds++;
    try {
      await this.draining;
      const disk = await this.store.read(fromOffset);
      const merged = mergeReplay(disk, this.pending(), fromOffset);
      return { ...merged, firstAvailableOffset: this.store.firstAvailableOffset };
    } finally {
      this.holds--;
      if (this.persisting && this.queue.length > 0) this.kick();
    }
  }

  /** Espera a fila esvaziar (se estiver gravando). */
  async flush(): Promise<void> {
    while (this.persisting && this.holds === 0 && this.queue.length > 0) {
      this.kick();
      await this.draining;
    }
    await this.draining;
  }

  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    this.retryCancel?.();
    await this.store.close();
  }

  private kick(): void {
    if (this.draining || this.holds > 0) return;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && this.persisting && this.holds === 0) {
      const batch = this.takeBatch();
      if (!batch) break;
      try {
        const reason = this.dropped ? 'fila cheia ou disco cheio' : 'perdido';
        await this.store.append(batch.offset, batch.bytes, reason);
        this.dropped = false;
        this.queue.splice(0, batch.count);
        this.queued -= batch.bytes.length;
      } catch (err) {
        this.fail(errorCode(err) === 'ENOSPC' ? 'DISK_FULL' : 'IO_ERROR', err);
        return;
      }
    }
  }

  /** Junta pedaços contíguos do início da fila numa só gravação (até 1 MB). */
  private takeBatch(): { offset: number; bytes: Uint8Array; count: number } | null {
    const head = this.queue[0];
    if (!head) return null;
    let count = 1;
    let size = head.bytes.length;
    let end = head.offset + head.bytes.length;
    while (count < this.queue.length) {
      const next = this.queue[count];
      if (!next || next.offset !== end || size + next.bytes.length > BATCH_BYTES) break;
      size += next.bytes.length;
      end += next.bytes.length;
      count++;
    }
    if (count === 1) return { offset: head.offset, bytes: head.bytes, count };
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (let i = 0; i < count; i++) {
      const c = this.queue[i] as PendingChunk;
      bytes.set(c.bytes, pos);
      pos += c.bytes.length;
    }
    return { offset: head.offset, bytes, count };
  }

  private fail(reason: 'DISK_FULL' | 'IO_ERROR', err: unknown): void {
    this.persisting = false;
    if (!this.reportedDown) {
      this.reportedDown = true;
      this.log.warn('scrollback.persist_stopped', { reason, code: errorCode(err) });
      this.onStatus({ persisting: false, reason });
    }
    this.retryCancel = this.clock.setTimeout(() => void this.retry(), this.retryMs);
  }

  private async retry(): Promise<void> {
    if (this.closed) return;
    this.persisting = true;
    await this.drain();
    if (this.persisting && this.reportedDown) {
      this.reportedDown = false;
      this.log.info('scrollback.persist_resumed');
      this.onStatus({ persisting: true });
    }
  }
}
