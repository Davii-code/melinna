import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const TOKEN_BYTES = 32;

/** Lê o segredo do hospedeiro ou cria um novo (32 bytes aleatórios, hex), com permissão restrita no POSIX. */
export function ensureToken(tokenPath: string): string {
  try {
    const existing = readFileSync(tokenPath, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(existing)) return existing;
  } catch {
    // ausente ou ilegível: cria abaixo
  }
  mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  writeFileSync(tokenPath, token, { mode: 0o600 });
  if (process.platform !== 'win32') chmodSync(tokenPath, 0o600);
  return token;
}

export function readToken(tokenPath: string): string {
  return readFileSync(tokenPath, 'utf8').trim();
}

/** Compara segredos em tempo constante. */
export function tokensEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
