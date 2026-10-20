import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_SEGMENTS,
  SEGMENT_BYTES,
  SegmentStore,
  segmentName,
  type ReplayItem,
} from '../../../../src/core/scrollback/segment-store';
import { MemoryFileSystem } from '../../../support/fakes/file-system';

const DIR = '/data/scrollback/e1';

function setup() {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  return { fs, store: new SegmentStore(fs, DIR, join) };
}

function fill(n: number, byte = 0x61): Uint8Array {
  return new Uint8Array(n).fill(byte);
}

function dataOf(items: ReplayItem[]): number {
  return items.reduce((n, it) => n + (it.kind === 'data' ? it.bytes.length : 0), 0);
}

describe('SegmentStore', () => {
  it('names segments by start offset with 16 digits', () => {
    expect(segmentName(0)).toBe('0000000000000000.seg');
    expect(segmentName(2097152)).toBe('0000000002097152.seg');
  });

  it('closes a segment at 2 MB and opens the next at the following offset', async () => {
    const { fs, store } = setup();
    await store.open();
    await store.append(0, fill(SEGMENT_BYTES + 10));
    const files = (await fs.readdir(DIR)).filter((f) => f.endsWith('.seg'));
    expect(files).toEqual([segmentName(0), segmentName(SEGMENT_BYTES)]);
    expect((await fs.stat(join(DIR, segmentName(0)))).size).toBe(SEGMENT_BYTES);
    expect(store.totalBytes).toBe(SEGMENT_BYTES + 10);
  });

  it('deletes the oldest before opening a fifth segment and never keeps 5 files', async () => {
    const { fs, store } = setup();
    await store.open();
    for (let i = 0; i < 5; i++) {
      await store.append(i * SEGMENT_BYTES, fill(SEGMENT_BYTES));
      const segs = (await fs.readdir(DIR)).filter((f) => f.endsWith('.seg'));
      expect(segs.length).toBeLessThanOrEqual(MAX_SEGMENTS);
    }
    await store.append(5 * SEGMENT_BYTES, fill(1));
    const segs = (await fs.readdir(DIR)).filter((f) => f.endsWith('.seg'));
    expect(segs).toHaveLength(MAX_SEGMENTS);
    expect(segs[0]).toBe(segmentName(2 * SEGMENT_BYTES));
    expect(store.firstAvailableOffset).toBe(2 * SEGMENT_BYTES);
    const bytesOnDisk = await Promise.all(segs.map(async (s) => (await fs.stat(join(DIR, s))).size));
    expect(bytesOnDisk.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('writes meta.json atomically', async () => {
    const { fs, store } = setup();
    await store.open();
    await store.append(0, fill(5));
    await store.close();
    const meta = JSON.parse(fs.readText(join(DIR, 'meta.json'))) as {
      totalBytes: number;
      schemaVersion: number;
    };
    expect(meta).toMatchObject({ schemaVersion: 1, totalBytes: 5 });
    expect(await fs.exists(join(DIR, 'meta.json.tmp'))).toBe(false);
  });

  it('reads from an available offset and from a discarded one with a discarded marker', async () => {
    const { store } = setup();
    await store.open();
    await store.append(0, new TextEncoder().encode('abcdef'));
    const items = await store.read(2);
    expect(items).toEqual([{ kind: 'data', offset: 2, bytes: new TextEncoder().encode('cdef') }]);

    const big = setup();
    await big.store.open();
    for (let i = 0; i < 6; i++) await big.store.append(i * SEGMENT_BYTES, fill(SEGMENT_BYTES));
    const replay = await big.store.read(0);
    expect(replay[0]).toEqual({ kind: 'marker', marker: 'discarded', lostBytes: 2 * SEGMENT_BYTES });
    expect(dataOf(replay)).toBe(4 * SEGMENT_BYTES);
  });

  it('records gaps when bytes are skipped and reports them on read', async () => {
    const { store } = setup();
    await store.open();
    await store.append(0, fill(10));
    await store.append(20, fill(5), 'disco cheio');
    const meta = store.snapshot();
    expect(meta.gaps).toEqual([{ at: 10, lostBytes: 10, reason: 'disco cheio' }]);
    const items = await store.read(0);
    expect(
      items.map((i) => (i.kind === 'data' ? `d${i.offset}:${i.bytes.length}` : `${i.marker}:${i.lostBytes}`)),
    ).toEqual(['d0:10', 'gap:10', 'd20:5']);
  });

  it('continues offsets from totalBytes after reopening (relaunch or new host)', async () => {
    const { fs, store } = setup();
    await store.open();
    await store.append(0, fill(7));
    await store.close();
    const reopened = new SegmentStore(fs, DIR, join);
    await reopened.open();
    expect(reopened.totalBytes).toBe(7);
    const separator = new TextEncoder().encode('\r\n── relançado ──\r\n');
    await reopened.append(7, separator);
    const items = await reopened.read(0);
    expect(dataOf(items)).toBe(7 + separator.length);
    expect(items.every((i) => i.kind === 'data')).toBe(true);
  });

  it('ignores bytes already written (no duplication)', async () => {
    const { store } = setup();
    await store.open();
    await store.append(0, fill(10));
    await store.append(5, fill(10, 0x62));
    expect(store.totalBytes).toBe(15);
  });
});
