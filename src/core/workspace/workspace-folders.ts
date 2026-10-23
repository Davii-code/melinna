import { MelinnaError } from '../errors';
import { newId } from '../ids';
import { normalizeRepoPath, pathModule, repoIdOf } from '../paths';
import type { WorkspaceFolder } from '../persistence/state-schema';
import type { OsName } from '../ports/platform';

export const MAX_FOLDERS = 32;

/** Pastas de um workspace e qual delas é a principal. */
export interface FolderSet {
  folders: WorkspaceFolder[];
  primaryFolderId: string;
}

function invalid(userMessage: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage });
}

function tooMany(): MelinnaError {
  return invalid(`Um workspace pode ter no máximo ${MAX_FOLDERS} pastas.`);
}

function hasPath(folders: readonly WorkspaceFolder[], path: string, os: OsName): boolean {
  const key = normalizeRepoPath(path, os);
  return folders.some((f) => normalizeRepoPath(f.path, os) === key);
}

function indexOfFolder(set: FolderSet, folderId: string): number {
  const index = set.folders.findIndex((f) => f.id === folderId);
  if (index < 0) throw invalid('Pasta não encontrada neste workspace.');
  return index;
}

/**
 * Monta o conjunto de pastas a partir de caminhos já conferidos no disco: normaliza cada caminho,
 * recusa repetidos e mais de {@link MAX_FOLDERS}, e marca como principal a pasta de `primaryIndex`.
 */
export function normalizeFolders(paths: readonly string[], os: OsName, primaryIndex = 0): FolderSet {
  if (paths.length === 0) throw invalid('Um workspace precisa de ao menos uma pasta.');
  if (paths.length > MAX_FOLDERS) throw tooMany();
  if (!Number.isInteger(primaryIndex) || primaryIndex < 0 || primaryIndex >= paths.length) {
    throw invalid('Escolha a pasta principal entre as pastas do workspace.');
  }
  const p = pathModule(os);
  const folders: WorkspaceFolder[] = [];
  for (const raw of paths) {
    const path = p.resolve(raw);
    if (hasPath(folders, path, os)) throw invalid(`A pasta ${raw} já está neste workspace.`);
    folders.push({ id: newId(), path });
  }
  return { folders, primaryFolderId: (folders[primaryIndex] as WorkspaceFolder).id };
}

/** Acrescenta uma pasta ao fim; a principal não muda. */
export function addFolder(set: FolderSet, path: string, os: OsName): FolderSet {
  if (set.folders.length >= MAX_FOLDERS) throw tooMany();
  const resolved = pathModule(os).resolve(path);
  if (hasPath(set.folders, resolved, os)) throw invalid(`A pasta ${path} já está neste workspace.`);
  return { ...set, folders: [...set.folders, { id: newId(), path: resolved }] };
}

/** Tira uma pasta; a última é recusada, e se era a principal a próxima (ou a anterior, se era a última) assume. */
export function removeFolder(set: FolderSet, folderId: string): FolderSet {
  const index = indexOfFolder(set, folderId);
  if (set.folders.length === 1) throw invalid('Um workspace precisa de ao menos uma pasta.');
  const folders = set.folders.filter((f) => f.id !== folderId);
  if (set.primaryFolderId !== folderId) return { folders, primaryFolderId: set.primaryFolderId };
  const successor = folders[Math.min(index, folders.length - 1)] as WorkspaceFolder;
  return { folders, primaryFolderId: successor.id };
}

export function setPrimary(set: FolderSet, folderId: string): FolderSet {
  indexOfFolder(set, folderId);
  return { ...set, primaryFolderId: folderId };
}

export function primaryOf(set: FolderSet): WorkspaceFolder {
  return set.folders[indexOfFolder(set, set.primaryFolderId)] as WorkspaceFolder;
}

/** Pastas que não são a principal, na ordem do workspace. */
export function extrasOf(set: FolderSet): WorkspaceFolder[] {
  return set.folders.filter((f) => f.id !== set.primaryFolderId);
}

/** Campos de compatibilidade do grupo, derivados da pasta principal. */
export function derivedRepo(set: FolderSet, os: OsName): { repoPath: string; repoId: string } {
  const primary = primaryOf(set);
  return { repoPath: primary.path, repoId: repoIdOf(primary.path, os) };
}
