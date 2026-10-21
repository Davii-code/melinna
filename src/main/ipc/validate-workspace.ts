import { LIMITS } from '../../shared/ipc-contract';
import { existing, invalid, noArgs, optStr, str } from './validate-common';

export interface WorkspaceIds {
  group: (id: string) => boolean;
  task: (id: string) => boolean;
}

export const parseSnapshot = noArgs;
export function parsePickRepository(args: unknown[]): [string | undefined] {
  if (args.length > 1) throw invalid('argumentos');
  return [optStr(args[0], 'pasta inicial', LIMITS.path)];
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
