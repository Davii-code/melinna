import { describe, expect, it } from 'vitest';
import { TerminalQueryResponder } from '../../../src/host/query-responder';

const enc = (s: string) => new TextEncoder().encode(s);

describe('TerminalQueryResponder', () => {
  const r = () => new TerminalQueryResponder(() => 24);

  it('answers DA1, DA2, DSR and CPR', () => {
    expect(r().observe(enc('\x1b[c'))).toEqual(['\x1b[?1;2c']);
    expect(r().observe(enc('\x1b[0c'))).toEqual(['\x1b[?1;2c']);
    expect(r().observe(enc('\x1b[>c'))).toEqual(['\x1b[>0;0;0c']);
    expect(r().observe(enc('\x1b[>0c'))).toEqual(['\x1b[>0;0;0c']);
    expect(r().observe(enc('\x1b[5n'))).toEqual(['\x1b[0n']);
    expect(r().observe(enc('\x1b[6n'))).toEqual(['\x1b[24;1R']);
  });

  it('answers OSC 10/11 with the theme colors and the same terminator', () => {
    expect(r().observe(enc('\x1b]10;?\x07'))).toEqual(['\x1b]10;rgb:e6e6/e9e9/efef\x07']);
    expect(r().observe(enc('\x1b]11;?\x1b\\'))).toEqual(['\x1b]11;rgb:0707/0808/0b0b\x1b\\']);
  });

  it('recognizes queries split across chunks, byte by byte', () => {
    const responder = r();
    const all = enc('texto \x1b[6n mais \x1b]11;?\x1b\\ fim \x1b[c');
    const replies: string[] = [];
    for (const b of all) replies.push(...responder.observe(new Uint8Array([b])));
    expect(replies).toEqual(['\x1b[24;1R', '\x1b]11;rgb:0707/0808/0b0b\x1b\\', '\x1b[?1;2c']);
  });

  it('ignores ordinary escape sequences and other OSC', () => {
    expect(r().observe(enc('\x1b[32mverde\x1b[0m\x1b[2J\x1b[10;5H\x1b]0;título\x07\x1b[?25l'))).toEqual([]);
    expect(r().observe(enc('\x1b[6;1n'))).toEqual([]);
  });

  it('uses the current number of rows for CPR', () => {
    let rows = 10;
    const responder = new TerminalQueryResponder(() => rows);
    expect(responder.observe(enc('\x1b[6n'))).toEqual(['\x1b[10;1R']);
    rows = 50;
    expect(responder.observe(enc('\x1b[6n'))).toEqual(['\x1b[50;1R']);
  });
});

describe('hostShouldRespond', () => {
  it('responds only without an attached connection or while replaying', async () => {
    const { hostShouldRespond } = await import('../../../src/host/query-responder');
    expect(hostShouldRespond(0, 0)).toBe(true);
    expect(hostShouldRespond(1, 0)).toBe(false);
    expect(hostShouldRespond(1, 1)).toBe(true);
  });
});
