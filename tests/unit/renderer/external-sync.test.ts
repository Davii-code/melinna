import { describe, expect, it, vi } from 'vitest';
import { createDraftStore } from '../../../src/renderer/components/Editor/editor-session';
import {
  syncExternalDrafts,
  watchExternalDrafts,
} from '../../../src/renderer/components/Editor/external-sync';

describe('external draft sync', () => {
  it('preserves a clean draft when the external file exceeds the reader limit', async () => {
    const drafts = createDraftStore();
    drafts.set('/a', { text: 'old', baseHash: 'h1', dirty: false });
    const conflict = vi.fn();
    await syncExternalDrafts(
      drafts,
      async () => ({ content: '', hash: 'h2', binary: false, truncated: true }),
      conflict,
    );
    expect(drafts.snapshot()['/a']?.text).toBe('old');
    expect(conflict).toHaveBeenCalledOnce();
  });
  it('shares one focus read between split panes and removes the final listener', async () => {
    const drafts = createDraftStore();
    drafts.set('/a', { text: 'old', baseHash: 'h1', dirty: true });
    const read = vi.fn(async () => ({ content: 'disk', hash: 'h2', binary: false }));
    const first = vi.fn(),
      second = vi.fn();
    const offFirst = watchExternalDrafts(drafts, read, first);
    const offSecond = watchExternalDrafts(drafts, read, second);
    window.dispatchEvent(new Event('focus'));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    offFirst();
    offSecond();
    window.dispatchEvent(new Event('focus'));
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('reloads clean documents but preserves and reports dirty documents', async () => {
    const drafts = createDraftStore();
    drafts.set('/a', { text: 'old', baseHash: 'h1', dirty: false });
    drafts.set('/b', { text: 'local', baseHash: 'h1', dirty: true });
    const conflicts = vi.fn();
    await syncExternalDrafts(drafts, async () => ({ content: 'disk', hash: 'h2', binary: false }), conflicts);
    expect(drafts.snapshot()['/a']).toEqual({ text: 'disk', baseHash: 'h2', dirty: false });
    expect(drafts.snapshot()['/b']?.text).toBe('local');
    expect(conflicts).toHaveBeenCalledWith('/b', expect.objectContaining({ content: 'disk' }));
  });
  it('never replaces a draft edited while reading the disk', async () => {
    const drafts = createDraftStore();
    drafts.set('/a', { text: 'old', baseHash: 'h1', dirty: false });
    let finish!: (value: { content: string; hash: string; binary: boolean }) => void;
    const pending = syncExternalDrafts(
      drafts,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      vi.fn(),
    );
    drafts.set('/a', { text: 'typing', baseHash: 'h1', dirty: true });
    finish({ content: 'disk', hash: 'h2', binary: false });
    await pending;
    expect(drafts.snapshot()['/a']?.text).toBe('typing');
  });
  it('reports unreadable files without dropping their text', async () => {
    const drafts = createDraftStore();
    drafts.set('/a', { text: 'local', baseHash: 'h1', dirty: false });
    const conflict = vi.fn();
    await syncExternalDrafts(
      drafts,
      async () => {
        throw new Error('removido');
      },
      conflict,
    );
    expect(drafts.snapshot()['/a']?.text).toBe('local');
    expect(conflict).toHaveBeenCalledWith('/a', expect.objectContaining({ error: 'removido' }));
  });
});
