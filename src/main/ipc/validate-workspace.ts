import type { WorkspaceChange } from '../../core/api-types';
import { LIMITS } from '../../shared/ipc-contract';
import { existing, id, int, invalid, isObj, noArgs, oneOf, optStr, str } from './validate-common';

const MAX_FOLDERS = 32;
const CHANGE_KINDS = ['rename', 'addFolders', 'removeFolder', 'setPrimary'] as const;

export interface WorkspaceIds {
  group: (id: string) => boolean;
  task: (id: string) => boolean;
}

export const parseSnapshot = noArgs;
export function parsePickRepository(args: unknown[]): [string | undefined] {
  if (args.length > 1) throw invalid('argumentos');
  return [optStr(args[0], 'pasta inicial', LIMITS.path)];
}

export function parsePickFolders(args: unknown[]): [string | undefined] {
  if (args.length > 1) throw invalid('argumentos');
  return [optStr(args[0], 'pasta inicial', LIMITS.path)];
}

function folderList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_FOLDERS) throw invalid('pastas do workspace');
  return v.map((p) => str(p, 'pasta do workspace', 1, LIMITS.path));
}

export function parseCreateWorkspace(
  args: unknown[],
): [{ name: string; folders: string[]; primaryIndex?: number }] {
  const input = args[0];
  if (args.length !== 1 || !isObj(input)) throw invalid('workspace');
  const name = str(input.name, 'nome do workspace', 1, LIMITS.groupName);
  const folders = folderList(input.folders);
  if (input.primaryIndex === undefined) return [{ name, folders }];
  return [{ name, folders, primaryIndex: int(input.primaryIndex, 'pasta principal', 0, folders.length - 1) }];
}

export function parseUpdateWorkspace(ids: WorkspaceIds) {
  return (args: unknown[]): [string, WorkspaceChange] => {
    const change = args[1];
    if (args.length !== 2 || !isObj(change)) throw invalid('mudança do workspace');
    const groupId = existing(args[0], 'Workspace', ids.group);
    switch (oneOf(change.kind, 'tipo da mudança', CHANGE_KINDS)) {
      case 'rename':
        return [groupId, { kind: 'rename', name: str(change.name, 'nome do workspace', 1, LIMITS.groupName) }];
      case 'addFolders':
        return [groupId, { kind: 'addFolders', folders: folderList(change.folders) }];
      case 'removeFolder':
        return [groupId, { kind: 'removeFolder', folderId: id(change.folderId, 'pasta') }];
      case 'setPrimary':
        return [groupId, { kind: 'setPrimary', folderId: id(change.folderId, 'pasta') }];
    }
  };
}

export function parseCreateGroup(args: unknown[]): [string] {
  return [str(args[0], 'nome do grupo', 1, LIMITS.groupName)];
}

export function parseRenameGroup(ids: WorkspaceIds) {
  return (args: unknown[]): [string, string] => [
    existing(args[0], 'Grupo', ids.group),
    str(args[1], 'nome do grupo', 1, LIMITS.groupName),
  ];
}

export function parseRenameTask(ids: WorkspaceIds) {
  return (args: unknown[]): [string, string] => [
    existing(args[0], 'Tarefa', ids.task),
    str(args[1], 'título da tarefa', 1, LIMITS.taskTitle),
  ];
}

export function parseInspectRepo(args: unknown[]): [string, string] {
  return [str(args[0], 'caminho do repositório'), str(args[1], 'ponto de partida', 1, LIMITS.baseRef)];
}

export function parseOpenWorkspace(args: unknown[]): [string, string | undefined] {
  return [str(args[0], 'pasta do workspace'), optStr(args[1], 'nome do workspace', LIMITS.groupName)];
}

export function parseCleanResidue(args: unknown[]): [string] {
  return [str(args[0], 'caminho do resíduo')];
}
