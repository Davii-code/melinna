import { MelinnaError } from '../errors';
import { MAX_FRAME_BYTES, type Frame } from './host-protocol';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const EMPTY = new Uint8Array(0);

export function encodeFrame(header: object, payload: Uint8Array = EMPTY): Uint8Array {
  const headerBytes = encoder.encode(JSON.stringify(header));
  if (headerBytes.length + payload.length > MAX_FRAME_BYTES) {
    throw new MelinnaError('HOST_PROTOCOL', { details: { reason: 'quadro acima do limite' } });
  }
  const out = new Uint8Array(8 + headerBytes.length + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, headerBytes.length);
  view.setUint32(4, payload.length);
  out.set(headerBytes, 8);
  out.set(payload, 8 + headerBytes.length);
  return out;
}

/** Remonta quadros a partir de pedaços arbitrários de um fluxo. */
export class FrameDecoder {
  private chunks: Uint8Array[] = [];
  private buffered = 0;

  push(chunk: Uint8Array): Frame<unknown>[] {
    if (chunk.length > 0) {
      this.chunks.push(chunk);
      this.buffered += chunk.length;
    }
    const frames: Frame<unknown>[] = [];
    for (;;) {
      if (this.buffered < 8) break;
      const head = this.peek(8);
      const view = new DataView(head.buffer, head.byteOffset, 8);
      const headerLength = view.getUint32(0);
      const payloadLength = view.getUint32(4);
      if (headerLength + payloadLength > MAX_FRAME_BYTES) {
        throw new MelinnaError('HOST_PROTOCOL', { details: { reason: 'quadro acima do limite' } });
      }
      const total = 8 + headerLength + payloadLength;
      if (this.buffered < total) break;
      const bytes = this.take(total);
      let header: unknown;
      try {
        header = JSON.parse(decoder.decode(bytes.subarray(8, 8 + headerLength)));
      } catch (cause) {
        throw new MelinnaError('HOST_PROTOCOL', { details: { reason: 'JSON inválido' }, cause });
      }
      frames.push({ header, payload: bytes.slice(8 + headerLength, total) });
    }
    return frames;
  }

  private peek(n: number): Uint8Array {
    const first = this.chunks[0];
    if (first && first.length >= n) return first.subarray(0, n);
    return this.concat(n, false);
  }

  private take(n: number): Uint8Array {
    return this.concat(n, true);
  }

  private concat(n: number, consume: boolean): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    let i = 0;
    while (filled < n) {
      const c = this.chunks[i];
      if (!c) break;
      const need = n - filled;
      if (c.length <= need) {
        out.set(c, filled);
        filled += c.length;
        i++;
      } else {
        out.set(c.subarray(0, need), filled);
        filled += need;
        if (consume) this.chunks[i] = c.subarray(need);
      }
    }
    if (consume) {
      this.chunks.splice(0, i);
      this.buffered -= n;
    }
    return out;
  }
}
