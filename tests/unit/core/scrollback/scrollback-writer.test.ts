import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScrollbackWriter, type PersistStatus } from '../../../../src/core/scrollback/scrollback-writer';
import { SegmentStore } from '../../../../src/core/scrollback/segment-store';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const DIR = '/data/scrollback/e1';
const enc = (s: string) => new TextEncoder().encode(s);

async function setup(maxPending?: number) {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const store = new SegmentStore(fs, DIR, join);
  await store.open();
  const clock = new FakeClock(0);
  const statuses: PersistStatus[] = [];
  const writer = new ScrollbackWriter(store, clock, new MemoryLogger(), (s) => statuses.push(s), maxPending);
  return { fs, store, clock, statuses, writer };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('ScrollbackWriter', () => {
  it('push never blocks the producer and flush writes everything in order', async () => {
    const { writer, store } = await setup();
    writer.push(0, enc('abc'));
    writer.push(3, enc('def'));
    expect(writer.pending().length).toBeGreaterThan(0);
    await writer.flush();
    expect(writer.pending()).toEqual([]);
    const items = await store.read(0);
    expect(new TextDecoder().decode(items[0]?.kind === 'data' ? items[0].bytes : new Uint8Array())).toBe(
      'abcdef',
    );
  });

  it('drops the oldest above the pending limit and records a gap', async () => {
    const { writer, fs } = await setup(10);
    fs.failOn('appendFile', () => true, 'ENOSPC', 1);
    writer.push(0, enc('aaaa'));
    await settle();
    writer.push(4, enc('bbbb'));
    writer.push(8, enc('cccc'));
    writer.push(12, enc('dddd'));
    expect(writer.pending().map((c) => c.offset)).toEqual([8, 12]);
    expect(writer.isPersisting()).toBe(false);
  });

  it('on ENOSPC stops writing, reports DISK_FULL, retries every 30 s and resumes with a gap mark', async () => {
    const { writer, store, fs, clock, statuses } = await setup(8);
    fs.failOn('appendFile', () => true, 'ENOSPC');
    writer.push(0, enc('1234'));
    await settle();
    expect(statuses).toEqual([{ persisting: false, reason: 'DISK_FULL' }]);
    writer.push(4, enc('5678'));
    writer.push(8, enc('9abc'));
    clock.advance(30_000);
    await settle();
    expect(statuses).toHaveLength(1);
    fs.clearFailures();
    clock.advance(30_000);
    await settle();
    await writer.flush();
    expect(statuses).toEqual([{ persisting: false, reason: 'DISK_FULL' }, { persisting: true }]);
    const meta = store.snapshot();
    expect(meta.gaps).toEqual([{ at: 0, lostBytes: 4, reason: 'fila cheia ou disco cheio' }]);
    expect(store.totalBytes).toBe(12);
  });

  it('replays disk plus pending memory without gaps or duplicates', async () => {
    const { writer, fs } = await setup();
    writer.push(0, enc('abc'));
    await writer.flush();
    fs.failOn('appendFile', () => true, 'EIO');
    writer.push(3, enc('def'));
    await settle();
    const r = await writer.replayFrom(1);
    const text = r.items
      .map((i) => (i.kind === 'data' ? new TextDecoder().decode(i.bytes) : `[${i.marker}]`))
      .join('');
    expect(text).toBe('bcdef');
    expect(r.endOffset).toBe(6);
  });

  it('flush before a read guarantees all pushed bytes are on disk', async () => {
    const { writer, store } = await setup();
    for (let i = 0; i < 50; i++) writer.push(i * 2, enc('xy'));
    const r = await writer.replayFrom(0);
    expect(r.endOffset).toBe(100);
    expect(store.totalBytes).toBe(100);
  });
});
