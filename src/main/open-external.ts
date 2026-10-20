import { MelinnaError } from '../core/errors';
import { LIMITS } from '../shared/ipc-contract';

/** Só abre links http/https; qualquer outro esquema (file:, javascript:…) é recusado. */
export function validateExternalUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > LIMITS.urlLength) {
    throw new MelinnaError('INPUT_INVALID', { userMessage: 'Link inválido.' });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MelinnaError('INPUT_INVALID', { userMessage: 'Link inválido.' });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new MelinnaError('INPUT_INVALID', { userMessage: 'Só links http e https podem ser abertos.' });
  }
  return url.toString();
}

export async function openExternal(raw: unknown, open: (url: string) => Promise<void>): Promise<void> {
  await open(validateExternalUrl(raw));
}
