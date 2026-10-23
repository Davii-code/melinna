import { nativeImage } from 'electron';

export const THUMBNAIL_MAX_SIDE = 256;

/** Subconjunto do `NativeImage` do Electron usado aqui; permite testar sem o Electron. */
export interface NativeImageLike {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(opts: { width: number; height: number; quality?: 'good' | 'better' | 'best' }): NativeImageLike;
  toPNG(): Uint8Array;
}

export interface NativeImageApi {
  createFromBuffer(buffer: Buffer): NativeImageLike;
}

/**
 * Miniatura em `data:image/png;base64,...` com o lado maior até 256 px (nunca amplia). Devolve texto
 * vazio quando o Electron não decodifica o formato (por exemplo GIF animado ou WebP): a prévia mostra
 * então só o nome, e o envio não depende da miniatura.
 */
export function createThumbnail(
  bytes: Uint8Array,
  native: NativeImageApi = nativeImage as unknown as NativeImageApi,
): string {
  let image: NativeImageLike;
  try {
    image = native.createFromBuffer(Buffer.from(bytes));
  } catch {
    return '';
  }
  if (image.isEmpty()) return '';
  const { width, height } = image.getSize();
  const longest = Math.max(width, height);
  const small =
    longest > THUMBNAIL_MAX_SIDE
      ? image.resize({
          width: Math.max(1, Math.round((width * THUMBNAIL_MAX_SIDE) / longest)),
          height: Math.max(1, Math.round((height * THUMBNAIL_MAX_SIDE) / longest)),
          quality: 'good',
        })
      : image;
  return `data:image/png;base64,${Buffer.from(small.toPNG()).toString('base64')}`;
}
