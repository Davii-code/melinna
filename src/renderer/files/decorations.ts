import type { FileChange } from '../../shared/ipc-contract';

const LETTER: Record<FileChange, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
};

const SEVERITY: Record<FileChange, number> = {
  deleted: 5,
  added: 4,
  renamed: 3,
  modified: 2,
  untracked: 1,
};

/** Caminho relativo à raiz no formato do git (barras normais, sem barra inicial). */
export function relativeToRoot(root: string, absolute: string): string {
  return absolute.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
}

/** Decoração de um arquivo, ou `null` quando ele está limpo. */
export function statusForPath(
  status: Readonly<Record<string, FileChange>>,
  root: string,
  absolute: string,
): FileChange | null {
  const rel = relativeToRoot(root, absolute);
  return status[rel] ?? null;
}

/**
 * Decoração de uma pasta: a mudança mais grave entre os arquivos abaixo dela. Pasta sem mudança
 * abaixo devolve `null`, para não poluir a árvore.
 */
export function statusForDir(
  status: Readonly<Record<string, FileChange>>,
  root: string,
  absolute: string,
): FileChange | null {
  const prefix = relativeToRoot(root, absolute);
  if (prefix === '') return null;
  const dirPrefix = `${prefix}/`;
  let best: FileChange | null = null;
  for (const [path, change] of Object.entries(status)) {
    if (!path.startsWith(dirPrefix)) continue;
    if (best === null || SEVERITY[change] > SEVERITY[best]) best = change;
  }
  return best;
}

export function statusLetter(change: FileChange): string {
  return LETTER[change];
}

export function statusLabel(change: FileChange): string {
  switch (change) {
    case 'added':
      return 'adicionado';
    case 'modified':
      return 'modificado';
    case 'deleted':
      return 'apagado';
    case 'renamed':
      return 'renomeado';
    case 'untracked':
      return 'não rastreado';
  }
}
