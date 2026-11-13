import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOOL_LAYOUT,
  readToolLayout,
  TOOL_LAYOUT_KEY,
  writeToolLayout,
} from '../../../src/renderer/components/Ide/tool-layout';

describe('IDE tool layout preferences', () => {
  it('uses defaults when storage is empty, malformed or contains invalid types', () => {
    const storage = { getItem: vi.fn(() => '{invalid') };
    expect(readToolLayout(storage)).toEqual(DEFAULT_TOOL_LAYOUT);
    storage.getItem.mockReturnValue(JSON.stringify({ open: 'yes', tab: 'unknown', height: 'large' }));
    expect(readToolLayout(storage)).toEqual(DEFAULT_TOOL_LAYOUT);
    storage.getItem.mockReturnValue('[]');
    expect(readToolLayout(storage)).toEqual(DEFAULT_TOOL_LAYOUT);
  });

  it.each([
    [
      { open: true, tab: 'database', height: 120 },
      { open: true, tab: 'database', height: 160 },
    ],
    [
      { open: false, tab: 'http', height: 900 },
      { open: false, tab: 'http', height: 600 },
    ],
    [
      { open: true, tab: 'debug', height: 301.6 },
      { open: true, tab: 'debug', height: 302 },
    ],
  ])('clamps and rounds stored values', (input, expected) => {
    expect(readToolLayout({ getItem: () => JSON.stringify(input) })).toEqual(expected);
  });

  it('round-trips normalized layout using the versioned key', () => {
    let value = '';
    const storage = {
      getItem: (key: string) => (key === TOOL_LAYOUT_KEY ? value : null),
      setItem: (key: string, next: string) => {
        expect(key).toBe(TOOL_LAYOUT_KEY);
        value = next;
      },
    };
    writeToolLayout(storage, { open: true, tab: 'http', height: 420 });
    expect(readToolLayout(storage)).toEqual({ open: true, tab: 'http', height: 420 });
  });

  it('keeps the in-memory caller state when storage read or quota write fails', () => {
    expect(
      readToolLayout({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_TOOL_LAYOUT);
    expect(() =>
      writeToolLayout(
        {
          setItem: () => {
            throw new Error('quota');
          },
        },
        { open: true, tab: 'debug', height: 300 },
      ),
    ).not.toThrow();
  });
});
