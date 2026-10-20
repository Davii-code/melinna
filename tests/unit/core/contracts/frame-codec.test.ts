import { describe, expect, it } from 'vitest';
import { FrameDecoder, encodeFrame } from '../../../../src/core/contracts/frame-codec';
import {
  MAX_FRAME_BYTES,
  parseClientMessage,
  parseHostMessage,
} from '../../../../src/core/contracts/host-protocol';
import { MelinnaError } from '../../../../src/core/errors';

function frameWith(headerLength: number, payloadLength: number, headerBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + headerBytes.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, headerLength);
  view.setUint32(4, payloadLength);
  out.set(headerBytes, 8);
  return out;
}

describe('frame codec', () => {
  it('round-trips header and payload', () => {
    const payload = new Uint8Array([0, 1, 2, 255]);
    const frame = encodeFrame({ t: 'output', execId: 'a', offset: 10 }, payload);
    const frames = new FrameDecoder().push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.header).toEqual({ t: 'output', execId: 'a', offset: 10 });
    expect(Array.from(frames[0]?.payload ?? [])).toEqual([0, 1, 2, 255]);
  });

  it('reassembles frames split byte by byte and several frames in one chunk', () => {
    const a = encodeFrame({ t: 'list', id: 1 });
    const b = encodeFrame({ t: 'write', execId: 'x' }, new TextEncoder().encode('olá'));
    const all = new Uint8Array([...a, ...b]);
    const dec = new FrameDecoder();
    const got = [];
    for (const byte of all) got.push(...dec.push(new Uint8Array([byte])));
    expect(got.map((f) => f.header)).toEqual([
      { t: 'list', id: 1 },
      { t: 'write', execId: 'x' },
    ]);
    expect(new TextDecoder().decode(got[1]?.payload)).toBe('olá');
    expect(new FrameDecoder().push(all)).toHaveLength(2);
  });

  it('rejects frames above 1 MB on encode and decode', () => {
    expect(() => encodeFrame({ t: 'write' }, new Uint8Array(MAX_FRAME_BYTES))).toThrow(MelinnaError);
    const dec = new FrameDecoder();
    try {
      dec.push(frameWith(10, MAX_FRAME_BYTES, new Uint8Array()));
      expect.unreachable();
    } catch (err) {
      expect((err as MelinnaError).code).toBe('HOST_PROTOCOL');
    }
  });

  it('rejects invalid JSON with HOST_PROTOCOL', () => {
    const bad = new TextEncoder().encode('{nope');
    try {
      new FrameDecoder().push(frameWith(bad.length, 0, bad));
      expect.unreachable();
    } catch (err) {
      expect((err as MelinnaError).code).toBe('HOST_PROTOCOL');
    }
  });
});

describe('protocol messages', () => {
  it('parses every client message type', () => {
    expect(parseClientMessage({ t: 'hello', protocolVersion: 1, token: 'ab' })).toEqual({
      t: 'hello',
      protocolVersion: 1,
      token: 'ab',
    });
    const spawn = parseClientMessage({
      t: 'spawn',
      id: 1,
      execId: 'e',
      file: '/bin/x',
      args: ['a'],
      cwd: '/w',
      env: { A: 'b' },
      cols: 80,
      rows: 24,
      separator: 's',
    });
    expect(spawn).toMatchObject({ t: 'spawn', separator: 's' });
    expect(parseClientMessage({ t: 'ack', execId: 'e', offset: 5 })).toEqual({
      t: 'ack',
      execId: 'e',
      offset: 5,
    });
    for (const m of [
      { t: 'write', execId: 'e' },
      { t: 'resize', execId: 'e', cols: 80, rows: 24 },
      { t: 'kill', id: 2, execId: 'e', graceMs: 10 },
      { t: 'attach', id: 3, execId: 'e', fromOffset: 0 },
      { t: 'detach', id: 4, execId: 'e' },
      { t: 'list', id: 5 },
      { t: 'shutdown', id: 6, graceMs: 0 },
    ]) {
      expect(parseClientMessage(m)).toEqual(m);
    }
  });

  it('rejects malformed client messages', () => {
    for (const m of [
      null,
      [],
      { t: 'nope' },
      { t: 'ack', execId: 'e', offset: -1 },
      { t: 'spawn', id: 1, execId: 'e', file: 'f', args: [1], cwd: '/', env: {}, cols: 1, rows: 1 },
      { t: 'spawn', id: 1, execId: 'e', file: 'f', args: [], cwd: '/', env: { a: 1 }, cols: 1, rows: 1 },
      { t: 'hello', protocolVersion: '1', token: 'x' },
    ]) {
      expect(() => parseClientMessage(m)).toThrow(MelinnaError);
    }
  });

  it('accepts host messages including ack-related and replay markers', () => {
    expect(parseHostMessage({ t: 'marker', execId: 'e', kind: 'replay-start' })).toMatchObject({
      kind: 'replay-start',
    });
    expect(parseHostMessage({ t: 'marker', execId: 'e', kind: 'replay-end' })).toMatchObject({
      kind: 'replay-end',
    });
    expect(() => parseHostMessage({ t: 'bogus' })).toThrow(MelinnaError);
  });
});
