import { MelinnaError } from '../../core/errors';
import { assertSafeRelPaths, assertSha } from '../../core/git/git-input';
import { CONFIRMS, type Confirm } from '../../core/git/git-types';
import { LIMITS } from '../../shared/ipc-contract';
import { id, invalid, isObj, str } from './validate-common';

export interface GitCommitArgs {
  paths: string[];
  message: string;
  amend: boolean;
  confirm: Confirm[];
}

function confirmList(v: unknown): Confirm[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > CONFIRMS.length) throw invalid('confirmações');
  for (const c of v) if (typeof c !== 'string' || !CONFIRMS.includes(c as Confirm)) throw invalid('confirmação');
  return v as Confirm[];
}

function branchShape(v: unknown, what: string): string {
  const name = str(v, what, 1, LIMITS.gitBranchName);
  if (name.startsWith('-') || /[\u0000-\u001f\u007f]/.test(name)) throw invalid(what);
  return name;
}

/** Parsers dos canais de git; `repo` só vale se for a raiz de uma pasta de workspace aberta. */
export function gitParsers(isRoot: (path: string) => boolean) {
  const repo = (v: unknown): string => {
    const path = str(v, 'pasta do repositório', 1, LIMITS.path);
    if (!isRoot(path)) throw new MelinnaError('FILE_OUTSIDE_ROOT');
    return path;
  };
  const paths = (v: unknown, min: number): string[] => {
    try {
      assertSafeRelPaths(v, LIMITS.gitPaths);
    } catch {
      throw invalid('lista de arquivos');
    }
    const list = v as string[];
    if (list.length < min) throw invalid('lista de arquivos');
    return list;
  };
  return {
    repoOnly: (args: unknown[]): [string] => [repo(args[0])],
    repoConfirm: (args: unknown[]): [string, Confirm[]] => [repo(args[0]), confirmList(args[1])],
    diffFile: (args: unknown[]): [string, string] => [repo(args[0]), paths([args[1]], 1)[0]!],
    commit: (args: unknown[]): [string, GitCommitArgs] => {
      const r = repo(args[0]);
      const input = args[1];
      if (!isObj(input)) throw invalid('dados do commit');
      if (typeof input.amend !== 'boolean') throw invalid('amend');
      const list = paths(input.paths, input.amend ? 0 : 1);
      const message = str(input.message, 'mensagem do commit', 1, LIMITS.gitMessage);
      if (message.trim().length === 0) throw invalid('mensagem do commit');
      return [r, { paths: list, message, amend: input.amend, confirm: confirmList(input.confirm) }];
    },
    discard: (args: unknown[]): [string, string[], Confirm[]] => [
      repo(args[0]),
      paths(args[1], 1),
      confirmList(args[2]),
    ],
    markResolved: (args: unknown[]): [string, string[]] => [repo(args[0]), paths(args[1], 1)],
    opId: (args: unknown[]): [string] => [id(args[0], 'operação')],
    branchName: (args: unknown[]): [string, string] => [repo(args[0]), branchShape(args[1], 'nome da branch')],
    branchConfirm: (args: unknown[]): [string, string, Confirm[]] => [
      repo(args[0]),
      branchShape(args[1], 'branch'),
      confirmList(args[2]),
    ],
    log: (args: unknown[]): [string, number] => {
      const skip = args[1];
      if (typeof skip !== 'number' || !Number.isInteger(skip) || skip < 0 || skip > 10_000_000) {
        throw invalid('posição do histórico');
      }
      return [repo(args[0]), skip];
    },
    commitDiff: (args: unknown[]): [string, string, string] => {
      const sha = args[1];
      try {
        assertSha(sha);
      } catch {
        throw invalid('commit');
      }
      return [repo(args[0]), sha, paths([args[2]], 1)[0]!];
    },
  };
}
