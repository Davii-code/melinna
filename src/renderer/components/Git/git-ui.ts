import type { Change, Commit, NeedsConfirm } from '../../../shared/ipc-contract';

export function isNeedsConfirm(value: unknown): value is NeedsConfirm {
  return typeof value === 'object' && value !== null && 'needsConfirm' in value;
}

export interface FolderGroup {
  /** Pasta dentro do repositório; vazio para os arquivos da raiz. */
  dir: string;
  label: string;
  changes: Change[];
}

export const ROOT_LABEL = '(raiz)';

/** Agrupa as alterações pela pasta do arquivo, a raiz primeiro e depois por ordem alfabética. */
export function groupByFolder(changes: readonly Change[]): FolderGroup[] {
  const byDir = new Map<string, Change[]>();
  for (const change of changes) {
    const slash = change.path.lastIndexOf('/');
    const dir = slash < 0 ? '' : change.path.slice(0, slash);
    byDir.set(dir, [...(byDir.get(dir) ?? []), change]);
  }
  return [...byDir.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([dir, list]) => ({ dir, label: dir === '' ? ROOT_LABEL : dir, changes: list }));
}

export function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

export const KIND_LABEL: Record<Change['kind'], string> = {
  modified: 'alterado',
  added: 'novo',
  untracked: 'novo',
  deleted: 'removido',
  renamed: 'renomeado',
  conflict: 'conflito',
};

/** "agora", "há 5 min", "há 2 h" ou "há 3 dias". */
export function relativeTime(iso: string | null, now: Date = new Date()): string {
  if (iso === null) return 'nunca';
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'agora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}

/** Caminho absoluto de um arquivo do repositório, no estilo de separador da raiz. */
export function absolutePath(repo: string, rel: string): string {
  const sep = repo.includes('\\') && !repo.includes('/') ? '\\' : '/';
  const clean = repo.replace(/[\\/]+$/, '');
  return `${clean}${sep}${sep === '\\' ? rel.replace(/\//g, '\\') : rel}`;
}

export const KIND_LABEL_COMMIT: Record<Commit['files'][number]['kind'], string> = {
  added: 'novo',
  modified: 'alterado',
  deleted: 'removido',
  renamed: 'renomeado',
  copied: 'copiado',
  typechange: 'tipo alterado',
};
