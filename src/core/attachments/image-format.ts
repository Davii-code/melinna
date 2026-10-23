import { MelinnaError } from '../errors';
import type { ImagesSpec } from '../catalog/schema';

export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 20;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** Formato da imagem pela assinatura dos bytes (a extensão pode mentir); `null` se não for um formato aceito. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, PNG)) return 'png';
  if (startsWith(bytes, JPEG)) return 'jpeg';
  if (startsWith(bytes, GIF)) return 'gif';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'webp';
  return null;
}

export function imageExtension(type: ImageType): string {
  return type === 'jpeg' ? 'jpg' : type;
}

/** Caractere de controle (C0, DEL ou C1): nunca vira texto digitado no PTY. */
export function hasControlChar(text: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/.test(text);
}

/**
 * Referência da imagem no prompt do agente, conforme o catálogo: `template` com `{path}` e aspas segundo
 * `quote` (`always`, ou `when-needed`: só com espaço ou aspas no caminho). Aspas internas são escapadas.
 */
export function formatImageRef(images: ImagesSpec, path: string): string {
  if (hasControlChar(path)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: 'O caminho da imagem tem caracteres que não podem ir para o terminal.',
    });
  }
  const needsQuotes = images.quote === 'always' || /[\s"]/.test(path);
  const text = needsQuotes ? `"${path.replaceAll('"', '\\"')}"` : path;
  return images.template.replace('{path}', () => text);
}
