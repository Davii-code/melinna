import { describe, expect, it } from 'vitest';
import { parseToolStart, parseToolCall } from '../../../../src/shared/ide-types';

describe('IDE input boundaries', () => {
  it('accepts explicit argv without constructing a shell command', () => {
    expect(
      parseToolStart({ protocol: 'lsp', root: '/repo', executable: '/bin/node', args: ['server.js'] }),
    ).toEqual({ protocol: 'lsp', root: '/repo', executable: '/bin/node', args: ['server.js'] });
  });
  it.each([
    null,
    {},
    { protocol: 'shell' },
    { protocol: 'lsp', root: '/repo', executable: 'server.cmd', args: [] },
    { protocol: 'lsp', root: '/repo', executable: 'node', args: ['a\u0000b'] },
  ])('refuses invalid or unsafe launch input', (input) => {
    expect(() => parseToolStart(input)).toThrow();
  });
  it('rejects methods and oversized envelopes outside the tool contract', () => {
    expect(() =>
      parseToolCall({ sessionId: 's1', method: 'workspace/executeCommand', params: {} }),
    ).toThrow();
    expect(() =>
      parseToolCall({
        sessionId: 's1',
        method: 'textDocument/hover',
        params: { text: 'x'.repeat(6 * 1024 * 1024) },
      }),
    ).toThrow();
    expect(parseToolCall({ sessionId: 's1', method: 'threads', params: {} }).method).toBe('threads');
  });
});
