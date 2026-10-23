import type { RunChoice, RunCommandInput } from '../../core/run/types';
import { LIMITS } from '../../shared/ipc-contract';
import { existing, id, invalid, isObj, oneOf, str, termSize } from './validate-common';

const CHOICES: readonly RunChoice[] = ['wrapper-sh', 'system-tool'];

export function parseRunStart(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string, string, { cols: number; rows: number }, RunChoice | undefined] => [
    existing(args[0], 'Workspace', groupExists),
    id(args[1], 'configuração'),
    termSize(args[2]),
    args[3] === undefined ? undefined : oneOf(args[3], 'escolha', CHOICES),
  ];
}

export function parseRerun(isCommandExecution: (id: string) => boolean | undefined) {
  return (args: unknown[]): [string, { cols: number; rows: number }] => {
    const execId = id(args[0], 'execução');
    const known = isCommandExecution(execId);
    if (known === undefined) throw invalid('execução não encontrada');
    if (!known) throw invalid('esta execução não é um comando');
    return [execId, termSize(args[1])];
  };
}

/** Forma da configuração personalizada; as regras de conteúdo (controle, nome único, pasta) ficam no núcleo. */
export function parseSaveCommand(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string, RunCommandInput] => {
    const groupId = existing(args[0], 'Workspace', groupExists);
    const v = args[1];
    if (!isObj(v)) throw invalid('configuração');
    if (!Array.isArray(v.args) || v.args.length > LIMITS.commandArgs) throw invalid('argumentos');
    const input: RunCommandInput = {
      label: str(v.label, 'nome', 1, LIMITS.commandLabel),
      program: str(v.program, 'programa', 1, LIMITS.path),
      args: v.args.map((a) => str(a, 'argumento', 0, LIMITS.commandArg)),
      folder: str(v.folder, 'pasta', 1, LIMITS.path),
    };
    if (v.id !== undefined) input.id = id(v.id, 'configuração');
    return [groupId, input];
  };
}

export function parseRemoveCommand(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string, string] => [
    existing(args[0], 'Workspace', groupExists),
    id(args[1], 'configuração'),
  ];
}
