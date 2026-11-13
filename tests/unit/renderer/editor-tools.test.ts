import { describe, expect, it } from 'vitest';
import { positionAt } from '../../../src/renderer/components/Ide/editor-tools';
import { positionOffset } from '../../../src/renderer/components/Ide/workspace-edits';
import { fileUri, uriPath } from '../../../src/shared/ide-paths';

describe('IDE editor positions and paths', () => {
  it('counts UTF-16 code units and CRLF without changing text', () => {
    const text = '🌿\r\nsecond';
    expect(positionAt(text, 4)).toEqual({ line: 1, character: 0 });
    expect(positionOffset(text, { line: 0, character: 2 })).toBe(2);
    expect(() => positionOffset(text, { line: 0, character: 3 })).toThrow();
  });
  it('round-trips paths containing spaces, percent, hash and Windows drive letters', () => {
    for (const path of ['/repo/a % #.ts', 'C:\\repo\\a #.ts']) expect(uriPath(fileUri(path))).toBe(path);
    expect(() => uriPath('https://example.test/a')).toThrow();
  });
});
