import type { FileChange } from '../api-types';

export interface GitStatusEntry {
  /** Caminho relativo à raiz, como o git reporta. */
  path: string;
  change: FileChange;
}

/**
 * Lê `git status --porcelain=v1 -z`: cada registro começa com o par XY e o caminho; renomeações e
 * cópias trazem o caminho antigo como registro seguinte, que não é uma entrada própria.
 */
export function parseStatusZ(out: string): GitStatusEntry[] {
  const parts = out.split('\0');
  const entries: GitStatusEntry[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry === undefined || entry.length < 4) continue;
    const x = entry[0];
    const y = entry[1];
    const path = entry.slice(3);
    if (x === 'R' || x === 'C') {
      // o próximo registro é o caminho de origem: consome sem virar entrada
      i += 1;
      entries.push({ path, change: 'renamed' });
      continue;
    }
    if (x === '?' || y === '?') {
      entries.push({ path, change: 'untracked' });
      continue;
    }
    if (x === 'A') {
      entries.push({ path, change: 'added' });
      continue;
    }
    if (x === 'D' || y === 'D') {
      entries.push({ path, change: 'deleted' });
      continue;
    }
    entries.push({ path, change: 'modified' });
  }
  return entries;
}

/** Ordem de precedência quando o mesmo arquivo aparece em mais de uma linha do status. */
const SEVERITY: Record<FileChange, number> = {
  deleted: 5,
  added: 4,
  renamed: 3,
  modified: 2,
  untracked: 1,
};

export function toStatusMap(entries: readonly GitStatusEntry[]): Record<string, FileChange> {
  const map: Record<string, FileChange> = {};
  for (const entry of entries) {
    const current = map[entry.path];
    if (current === undefined || SEVERITY[entry.change] > SEVERITY[current]) {
      map[entry.path] = entry.change;
    }
  }
  return map;
}
