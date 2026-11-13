import { describe, expect, it } from 'vitest';
import { MessageFramer, encodeMessage } from '../../../../src/core/ide/framing';

describe('protocol framing', () => {
  it('preserves multibyte characters across arbitrary chunks and multiple messages', () => {
    const first = encodeMessage({ text: 'ação 🍃' });
    const second = encodeMessage({ id: 2 });
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first);
    bytes.set(second, first.length);
    const parser = new MessageFramer();
    const messages = [...bytes].flatMap((byte) => parser.push(Uint8Array.of(byte)));
    expect(messages).toEqual([{ text: 'ação 🍃' }, { id: 2 }]);
  });
  it.each([
    'Content-Length: -1\r\n\r\n',
    'Content-Length: 999999999\r\n\r\n',
    'Content-Length: 1\r\nContent-Length: 2\r\n\r\n',
  ])('refuses invalid framing without buffering an unbounded body', (header) => {
    expect(() => new MessageFramer().push(new TextEncoder().encode(header))).toThrow();
  });
  it('bounds incomplete headers and rejects invalid JSON', () => {
    expect(() => new MessageFramer().push(new Uint8Array(9000).fill(65))).toThrow();
    expect(() => new MessageFramer().push(new TextEncoder().encode('Content-Length: 1\r\n\r\nx'))).toThrow();
  });
});
