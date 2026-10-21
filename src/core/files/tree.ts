import { pathModule } from '../paths';
import type { OsName } from '../ports/platform';

/** Teto de entradas por listagem: acima disso a pasta é reportada como truncada. */
export const MAX_ENTRIES = 5_000;
/** Teto de leitura de texto: acima disso o conteúdo vem cortado e marcado. */
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** Quantos bytes iniciais decidem se o arquivo é binário. */
const SNIFF_BYTES = 8 * 1024;

/** Forma de comparação de caminhos: no Windows o sistema de arquivos não distingue maiúsculas. */
export function normalizeForCompare(path: string, os: OsName): string {
  const resolved = pathModule(os).resolve(path);
  return os === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Verdadeiro se `candidate` está em `root` ou abaixo dele.
 *
 * Compara caminhos já canônicos (`realpath`): o chamador resolve links antes de perguntar, porque um
 * link simbólico pode apontar para fora da raiz.
 */
export function isInsideRoot(root: string, candidate: string, os: OsName): boolean {
  const p = pathModule(os);
  const rel = p.relative(normalizeForCompare(root, os), normalizeForCompare(candidate, os));
  if (rel === '') return true;
  if (p.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${p.sep}`);
}

/**
 * A raiz que contém `target`, com o caminho mais longo primeiro — o worktree de uma execução ganha do
 * repositório do workspace quando um está dentro do outro.
 */
export function pickRoot(roots: readonly string[], target: string, os: OsName): string | null {
  let best: string | null = null;
  for (const root of roots) {
    if (!isInsideRoot(root, target, os)) continue;
    if (best === null || normalizeForCompare(root, os).length > normalizeForCompare(best, os).length) {
      best = root;
    }
  }
  return best;
}

/** Compara nomes de forma natural: `f2` vem antes de `f10`, e maiúsculas não dominam a ordem. */
export function naturalCompare(a: string, b: string): number {
  const ax = a.toLowerCase();
  const bx = b.toLowerCase();
  let i = 0;
  let j = 0;
  while (i < ax.length && j < bx.length) {
    const ca = ax.charCodeAt(i);
    const cb = bx.charCodeAt(j);
    const da = ca >= 48 && ca <= 57;
    const db = cb >= 48 && cb <= 57;
    if (da && db) {
      let endA = i;
      while (endA < ax.length && ax.charCodeAt(endA) >= 48 && ax.charCodeAt(endA) <= 57) endA++;
      let endB = j;
      while (endB < bx.length && bx.charCodeAt(endB) >= 48 && bx.charCodeAt(endB) <= 57) endB++;
      const na = Number.parseInt(ax.slice(i, endA), 10);
      const nb = Number.parseInt(bx.slice(j, endB), 10);
      if (na !== nb) return na - nb;
      i = endA;
      j = endB;
      continue;
    }
    if (ca !== cb) return ca - cb;
    i++;
    j++;
  }
  if (i < ax.length) return 1;
  if (j < bx.length) return -1;
  // mesmo nome a menos da caixa: ordem estável entre `a` e `A`
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Detecta binário pela presença de byte nulo nos primeiros KB — a mesma heurística do git. */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) if (bytes[i] === 0) return true;
  return false;
}
