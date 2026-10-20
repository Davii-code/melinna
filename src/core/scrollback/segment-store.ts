import { writeFileAtomic } from '../persistence/atomic-file';
import { errorCode, type FileSystem } from '../ports/file-system';

export const SEGMENT_BYTES = 2 * 1024 * 1024;
export const MAX_SEGMENTS = 4;
export const SCROLLBACK_SCHEMA_VERSION = 1;

export interface GapRecord {
  at: number;
  lostBytes: number;
  reason: string;
}

export interface SegmentRecord {
  start: number;
  length: number;
}

export interface ScrollbackMeta {
  schemaVersion: number;
  totalBytes: number;
  firstAvailableOffset: number;
  gaps: GapRecord[];
  segments: SegmentRecord[];
}

export type ReplayItem =
  | { kind: 'data'; offset: number; bytes: Uint8Array }
  | { kind: 'marker'; marker: 'discarded' | 'gap'; lostBytes: number };

export function segmentName(start: number): string {
  return `${String(start).padStart(16, '0')}.seg`;
}

/**
 * Histórico de uma execução em disco: segmentos de 2 MB nomeados pelo deslocamento inicial,
 * no máximo 4 (8 MB). O mais antigo é apagado antes de abrir o quinto.
 */
export class SegmentStore {
  private meta: ScrollbackMeta = emptyMeta();
  private opened = false;

  constructor(
    private readonly fs: FileSystem,
    private readonly dir: string,
    private readonly join: (...parts: string[]) => string,
  ) {}

  get totalBytes(): number {
    return this.meta.totalBytes;
  }

  get firstAvailableOffset(): number {
    return this.meta.firstAvailableOffset;
  }

  snapshot(): ScrollbackMeta {
    return structuredClone(this.meta);
  }

  /** Abre ou cria o histórico; continua a numeração a partir de `totalBytes`. */
  async open(): Promise<void> {
    await this.fs.mkdir(this.dir, { recursive: true });
    let loaded: ScrollbackMeta | null = null;
    try {
      const raw = JSON.parse(
        new TextDecoder().decode(await this.fs.readFile(this.metaPath())),
      ) as ScrollbackMeta;
      if (typeof raw.totalBytes === 'number' && Array.isArray(raw.segments)) loaded = raw;
    } catch (err) {
      if (errorCode(err) !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }
    const meta = loaded ?? emptyMeta();
    // Os comprimentos reais vêm do disco: o meta só é regravado em mudanças de segmento.
    const segments: SegmentRecord[] = [];
    for (const s of meta.segments) {
      try {
        const st = await this.fs.stat(this.join(this.dir, segmentName(s.start)));
        segments.push({ start: s.start, length: st.size });
      } catch {
        // segmento sumido: tratado como descartado
      }
    }
    meta.segments = segments;
    const last = segments[segments.length - 1];
    meta.totalBytes = Math.max(meta.totalBytes, last ? last.start + last.length : 0);
    meta.firstAvailableOffset = segments[0]?.start ?? meta.totalBytes;
    meta.gaps = Array.isArray(meta.gaps) ? meta.gaps : [];
    this.meta = meta;
    this.opened = true;
    await this.saveMeta();
  }

  /** Grava bytes que começam em `offset`. Um `offset` à frente do fim registra uma lacuna. */
  async append(offset: number, bytes: Uint8Array, gapReason = 'perdido'): Promise<void> {
    if (!this.opened) await this.open();
    if (offset > this.meta.totalBytes)
      await this.recordGap(this.meta.totalBytes, offset - this.meta.totalBytes, gapReason);
    if (offset < this.meta.totalBytes) {
      const skip = this.meta.totalBytes - offset;
      if (skip >= bytes.length) return;
      bytes = bytes.subarray(skip);
      offset = this.meta.totalBytes;
    }
    let pos = 0;
    while (pos < bytes.length) {
      let seg = this.meta.segments[this.meta.segments.length - 1];
      const contiguous = seg && seg.start + seg.length === offset + pos;
      if (!seg || !contiguous || seg.length >= SEGMENT_BYTES) {
        seg = await this.openSegment(offset + pos);
      }
      const room = SEGMENT_BYTES - seg.length;
      const piece = bytes.subarray(pos, pos + room);
      await this.fs.appendFile(this.join(this.dir, segmentName(seg.start)), piece);
      seg.length += piece.length;
      pos += piece.length;
      this.meta.totalBytes = offset + pos;
    }
  }

  async recordGap(at: number, lostBytes: number, reason: string): Promise<void> {
    if (lostBytes <= 0) return;
    this.meta.gaps.push({ at, lostBytes, reason });
    this.meta.totalBytes = Math.max(this.meta.totalBytes, at + lostBytes);
    await this.saveMeta();
  }

  async close(): Promise<void> {
    if (this.opened) await this.saveMeta();
  }

  /** Lê o histórico a partir de `fromOffset`, com marcas de descarte e de lacuna. */
  async read(fromOffset: number): Promise<ReplayItem[]> {
    if (!this.opened) await this.open();
    const items: ReplayItem[] = [];
    let cursor = fromOffset;
    if (cursor < this.meta.firstAvailableOffset) {
      items.push({ kind: 'marker', marker: 'discarded', lostBytes: this.meta.firstAvailableOffset - cursor });
      cursor = this.meta.firstAvailableOffset;
    }
    for (const seg of this.meta.segments) {
      const end = seg.start + seg.length;
      if (end <= cursor) continue;
      if (seg.start > cursor) {
        items.push({ kind: 'marker', marker: 'gap', lostBytes: seg.start - cursor });
        cursor = seg.start;
      }
      const data = await this.fs.readFile(this.join(this.dir, segmentName(seg.start)));
      const slice = data.subarray(cursor - seg.start, Math.min(seg.length, data.length));
      if (slice.length > 0) items.push({ kind: 'data', offset: cursor, bytes: slice });
      cursor = end;
    }
    if (cursor < this.meta.totalBytes) {
      items.push({ kind: 'marker', marker: 'gap', lostBytes: this.meta.totalBytes - cursor });
    }
    return items;
  }

  private async openSegment(start: number): Promise<SegmentRecord> {
    while (this.meta.segments.length >= MAX_SEGMENTS) {
      const oldest = this.meta.segments.shift();
      if (oldest) await this.fs.rm(this.join(this.dir, segmentName(oldest.start)), { force: true });
    }
    const seg: SegmentRecord = { start, length: 0 };
    await this.fs.writeFile(this.join(this.dir, segmentName(start)), new Uint8Array(), { flag: 'w' });
    this.meta.segments.push(seg);
    this.meta.firstAvailableOffset = this.meta.segments[0]?.start ?? start;
    await this.saveMeta();
    return seg;
  }

  private metaPath(): string {
    return this.join(this.dir, 'meta.json');
  }

  private async saveMeta(): Promise<void> {
    await writeFileAtomic(this.fs, this.metaPath(), JSON.stringify(this.meta));
  }
}

function emptyMeta(): ScrollbackMeta {
  return {
    schemaVersion: SCROLLBACK_SCHEMA_VERSION,
    totalBytes: 0,
    firstAvailableOffset: 0,
    gaps: [],
    segments: [],
  };
}
