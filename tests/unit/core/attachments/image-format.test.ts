import { describe, expect, it } from 'vitest';
import {
  detectImageType,
  formatImageRef,
  imageExtension,
  MAX_FILES,
  MAX_IMAGE_BYTES,
} from '../../../../src/core/attachments/image-format';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

describe('constants', () => {
  it('limits an image to 20 MB and a send to 20 files', () => {
    expect(MAX_IMAGE_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_FILES).toBe(20);
  });
});

describe('detectImageType', () => {
  it('recognises PNG, JPEG, GIF and WebP by their signature', () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('png');
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('jpeg');
    expect(detectImageType(ascii('GIF89a......'))).toBe('gif');
    expect(detectImageType(ascii('GIF87a'))).toBe('gif');
    expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBPVP8 ')]))).toBe('webp');
  });

  it('returns null for anything else, including a PDF, text and a RIFF that is not WebP', () => {
    expect(detectImageType(ascii('%PDF-1.7'))).toBeNull();
    expect(detectImageType(ascii('texto qualquer'))).toBeNull();
    expect(detectImageType(Uint8Array.from([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVEfmt ')]))).toBeNull();
  });

  it('returns null for empty or too short input without throwing', () => {
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(bytes(0x89, 0x50))).toBeNull();
    expect(detectImageType(ascii('RIFF'))).toBeNull();
  });
});

describe('imageExtension', () => {
  it('maps each type to a file extension', () => {
    expect(imageExtension('png')).toBe('png');
    expect(imageExtension('jpeg')).toBe('jpg');
    expect(imageExtension('gif')).toBe('gif');
    expect(imageExtension('webp')).toBe('webp');
  });
});

describe('formatImageRef', () => {
  const plain = { template: '{path}', quote: 'when-needed' } as const;
  const at = { template: '@{path}', quote: 'when-needed' } as const;

  it('writes the bare path when it has no space and quoting is only when needed', () => {
    expect(formatImageRef(plain, '/data/a.png')).toBe('/data/a.png');
    expect(formatImageRef(at, '/data/a.png')).toBe('@/data/a.png');
  });

  it('quotes a path with a space when needed', () => {
    expect(formatImageRef(plain, '/meus dados/a.png')).toBe('"/meus dados/a.png"');
    expect(formatImageRef(at, 'C:\\Meus Dados\\a.png')).toBe('@"C:\\Meus Dados\\a.png"');
  });

  it('quotes always when asked, even without a space', () => {
    expect(formatImageRef({ template: '{path}', quote: 'always' }, '/data/a.png')).toBe('"/data/a.png"');
    expect(formatImageRef({ template: '@{path}', quote: 'always' }, '/data/a.png')).toBe('@"/data/a.png"');
  });

  it('escapes inner quotes and quotes a path that has them', () => {
    expect(formatImageRef(plain, '/d/a"b.png')).toBe('"/d/a\\"b.png"');
    expect(formatImageRef({ template: '{path}', quote: 'always' }, '/d/a"b.png')).toBe('"/d/a\\"b.png"');
  });

  it('refuses a path with a control character', () => {
    for (const bad of ['/d/a\nb.png', '/d/a\rb.png', '/d/a\tb.png', '/d/a\x1bb.png', '/d/a\0b.png', '/d/a\x7fb.png']) {
      expect(() => formatImageRef(plain, bad)).toThrow(expect.objectContaining({ code: 'INPUT_INVALID' }));
    }
  });
});
