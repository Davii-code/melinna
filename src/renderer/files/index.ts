import type { DirectoryListing, Result } from '../../shared/ipc-contract';

/** Pastas que nunca entram no índice: são grandes e não são fonte de trabalho. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'coverage',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

export const DEFAULT_INDEX_CAP = 2000;

export interface FileIndex {
  files: string[];
  /** Verdadeiro quando o teto cortou a varredura: a lista está incompleta. */
  truncated: boolean;
}

export type ListDir = (path: string) => Promise<Result<DirectoryListing>>;

/**
 * Índice de arquivos de uma raiz, montado em largura com a própria API de listagem.
 *
 * A varredura para no teto (`cap`) e para em erros de pasta (uma pasta sem permissão não impede o
 * resto do índice); o resultado diz se a lista ficou incompleta.
 */
export async function buildFileIndex(
  list: ListDir,
  root: string,
  cap: number = DEFAULT_INDEX_CAP,
): Promise<FileIndex> {
  const files: string[] = [];
  const queue: string[] = [root];
  const visited = new Set<string>([root]);
  while (queue.length > 0) {
    const dir = queue.shift() as string;
    const r = await list(dir);
    if (!r.ok) continue;
    for (const entry of r.value.entries) {
      if (entry.kind === 'file') {
        files.push(entry.path);
        if (files.length >= cap) return { files, truncated: true };
        continue;
      }
      if (SKIP_DIRS.has(entry.name) || visited.has(entry.path)) continue;
      visited.add(entry.path);
      queue.push(entry.path);
    }
  }
  return { files, truncated: false };
}

/** Filtro do "ir para arquivo": todos os termos aparecem no caminho, nome antes de caminho. */
export function filterIndex(files: readonly string[], query: string, limit = 50): string[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const scored: { path: string; score: number }[] = [];
  for (const path of files) {
    const lower = path.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    const name = lower.slice(lower.lastIndexOf('/') + 1).split('\\').pop() ?? '';
    const inName = terms.every((t) => name.includes(t)) ? 0 : 1;
    scored.push({ path, score: inName * 1000 + lower.length });
  }
  scored.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
  return scored.slice(0, limit).map((s) => s.path);
}
