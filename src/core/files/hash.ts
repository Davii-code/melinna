import { createHash } from 'node:crypto';

/** Hash do conteúdo, usado para detectar alteração em disco entre a leitura e o salvamento. */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
