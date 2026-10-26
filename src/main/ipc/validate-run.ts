import {
  RUN_CONFIG_TOOLS,
  type RunChoice,
  type RunConfigInput,
  type RunEnvVar,
  type RunReorderItem,
} from '../../core/run/types';
import { LIMITS } from '../../shared/ipc-contract';
import { bool, existing, id, int, invalid, isObj, oneOf, str, termSize } from './validate-common';

const CHOICES: readonly RunChoice[] = ['wrapper-sh', 'system-tool'];
const ENV_NAME_MAX = 256;

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

function parseArgs(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > LIMITS.commandArgs) throw invalid('argumentos');
  return v.map((a) => str(a, 'argumento', 0, LIMITS.commandArg));
}

function parseEnv(v: unknown): RunEnvVar[] {
  if (!Array.isArray(v) || v.length > LIMITS.envPairs) throw invalid('variáveis de ambiente');
  return v.map((pair) => {
    if (!isObj(pair)) throw invalid('variável de ambiente');
    return {
      name: str(pair.name, 'nome da variável', 0, ENV_NAME_MAX),
      value: str(pair.value, 'valor da variável', 0, LIMITS.envValue),
    };
  });
}

function nullable<T>(v: unknown, parse: (value: unknown) => T): T | null {
  return v === null ? null : parse(v);
}

/**
 * Forma da configuração; as regras de conteúdo (nome único, pasta do workspace, script detectado, nomes de
 * variáveis, ciclo) ficam no núcleo, que também ignora o programa recebido nas ferramentas.
 */
export function parseSaveConfig(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string, RunConfigInput] => {
    const groupId = existing(args[0], 'Workspace', groupExists);
    const v = args[1];
    if (!isObj(v)) throw invalid('configuração');
    const input: RunConfigInput = {
      name: str(v.name, 'nome', 1, LIMITS.commandLabel),
      tool: oneOf(v.tool, 'ferramenta', RUN_CONFIG_TOOLS),
      folder: str(v.folder, 'pasta', 1, LIMITS.path),
      script: nullable(v.script, (s) => str(s, 'script', 0, LIMITS.script)),
      program: str(v.program, 'programa', 0, LIMITS.path),
      args: parseArgs(v.args),
      runtimeOptions: str(v.runtimeOptions, 'opções do runtime', 0, LIMITS.runtimeOptions),
      env: parseEnv(v.env),
      beforeLaunch: nullable(v.beforeLaunch, (b) => id(b, 'antes de lançar')),
      allowParallel: bool(v.allowParallel, 'várias instâncias'),
      folderGroup: nullable(v.folderGroup, (g) => str(g, 'pasta de agrupamento', 0, LIMITS.folderGroup)),
    };
    if (v.id !== undefined) input.id = id(v.id, 'configuração');
    return [groupId, input];
  };
}

export function parseRemoveConfig(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string, string] => [
    existing(args[0], 'Workspace', groupExists),
    id(args[1], 'configuração'),
  ];
}

export function parseReorder(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string, RunReorderItem[]] => {
    const groupId = existing(args[0], 'Workspace', groupExists);
    const list = args[1];
    if (!Array.isArray(list) || list.length > LIMITS.reorderItems) throw invalid('lista de configurações');
    const items = list.map((item): RunReorderItem => {
      if (!isObj(item)) throw invalid('configuração');
      return {
        id: id(item.id, 'configuração'),
        folderGroup: nullable(item.folderGroup, (g) => str(g, 'pasta de agrupamento', 0, LIMITS.folderGroup)),
        order: int(item.order, 'posição', 0, 100_000),
      };
    });
    return [groupId, items];
  };
}
