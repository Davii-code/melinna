import { describe, expect, it } from 'vitest';
import { createDraftStore } from '../../../src/renderer/components/Editor/editor-session';
import { prepareWorkspaceEdit } from '../../../src/renderer/components/Ide/workspace-edits';

describe('semantic workspace edits', () => {
  it('prepares closed files and applies all drafts without writing to disk', async () => {
    const drafts = createDraftStore();
    const read = async (path: string) => ({
      path,
      content: 'old',
      hash: 'h',
      binary: false,
      truncated: false,
    });
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
    const prepared = await prepareWorkspaceEdit(
      { changes: { 'file:///a': [{ range, newText: 'new' }], 'file:///b': [{ range, newText: 'other' }] } },
      drafts,
      read,
      new Map(),
    );
    expect(Object.keys(drafts.snapshot())).toHaveLength(0);
    const observed: number[] = [];
    drafts.subscribe(() => observed.push(Object.keys(drafts.snapshot()).length));
    await prepared.apply();
    expect(observed).toEqual([2]);
    expect(drafts.snapshot()['/a']).toMatchObject({ text: 'new', dirty: true, baseHash: 'h' });
    expect(drafts.snapshot()['/b']?.text).toBe('other');
  });
  it('rejects overlapping edits and applies nothing when a snapshot changes', async () => {
    const drafts = createDraftStore();
    drafts.set('/a', { text: 'old', baseHash: 'h', dirty: false });
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } };
    const read = async (path: string) => ({
      path,
      content: 'old',
      hash: 'h',
      binary: false,
      truncated: false,
    });
    await expect(
      prepareWorkspaceEdit(
        {
          changes: {
            'file:///a': [
              { range, newText: 'x' },
              { range, newText: 'y' },
            ],
          },
        },
        drafts,
        read,
        new Map(),
      ),
    ).rejects.toThrow();
    const prepared = await prepareWorkspaceEdit(
      { changes: { 'file:///a': [{ range, newText: 'x' }] } },
      drafts,
      read,
      new Map(),
    );
    drafts.set('/a', { text: 'typing', baseHash: 'h', dirty: true });
    await expect(prepared.apply()).rejects.toThrow();
    expect(drafts.snapshot()['/a']?.text).toBe('typing');
  });
});
