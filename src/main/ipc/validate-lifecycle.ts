import { bool, existing, invalid, isObj, termSize } from './validate-common';

export type ExecutionExists = (id: string) => boolean;

export function parseExecId(exists: ExecutionExists) {
  return (args: unknown[]): [string] => [existing(args[0], 'Execução', exists)];
}

export function parseRelaunch(exists: ExecutionExists) {
  return (args: unknown[]): [string, { cols: number; rows: number }] => [
    existing(args[0], 'Execução', exists),
    termSize(args[1]),
  ];
}

export function parseRemove(exists: ExecutionExists) {
  return (args: unknown[]): [string, { deleteBranch: boolean; force: boolean }] => {
    const execId = existing(args[0], 'Execução', exists);
    const opts = args[1];
    if (!isObj(opts)) throw invalid('opções de remoção');
    return [
      execId,
      { deleteBranch: bool(opts.deleteBranch, 'apagar a branch'), force: bool(opts.force, 'remoção forçada') },
    ];
  };
}
