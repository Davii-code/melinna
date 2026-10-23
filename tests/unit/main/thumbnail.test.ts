import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ nativeImage: {} }));

import {
  createThumbnail,
  THUMBNAIL_MAX_SIDE,
  type NativeImageApi,
  type NativeImageLike,
} from '../../../src/main/thumbnail';

/** Imagem falsa: guarda o tamanho e devolve como PNG o texto `png:<largura>x<altura>`. */
function fakeImage(width: number, height: number, empty = false): NativeImageLike {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }) => fakeImage(w, h),
    toPNG: () => new TextEncoder().encode(`png:${width}x${height}`),
  };
}

function native(width: number, height: number, empty = false): NativeImageApi {
  return { createFromBuffer: () => fakeImage(width, height, empty) };
}

const decode = (dataUrl: string) => Buffer.from(dataUrl.split(',')[1] ?? '', 'base64').toString('utf8');
const bytes = new Uint8Array([1, 2, 3]);

describe('createThumbnail', () => {
  it('returns a PNG data URL', () => {
    expect(createThumbnail(bytes, native(100, 50))).toMatch(/^data:image\/png;base64,/);
  });

  it('scales a wide image so the longest side is 256 px, keeping the ratio', () => {
    expect(decode(createThumbnail(bytes, native(1024, 512)))).toBe('png:256x128');
  });

  it('scales a tall image so the longest side is 256 px', () => {
    expect(decode(createThumbnail(bytes, native(300, 1200)))).toBe('png:64x256');
  });

  it('never enlarges a smaller image', () => {
    expect(decode(createThumbnail(bytes, native(100, 40)))).toBe('png:100x40');
    expect(decode(createThumbnail(bytes, native(THUMBNAIL_MAX_SIDE, 10)))).toBe(`png:${THUMBNAIL_MAX_SIDE}x10`);
  });

  it('keeps at least 1 px on the short side of a very thin image', () => {
    expect(decode(createThumbnail(bytes, native(5000, 1)))).toBe('png:256x1');
  });

  it('returns an empty string when the image cannot be decoded', () => {
    expect(createThumbnail(bytes, native(0, 0, true))).toBe('');
    const throwing: NativeImageApi = {
      createFromBuffer: () => {
        throw new Error('boom');
      },
    };
    expect(createThumbnail(bytes, throwing)).toBe('');
  });
});
