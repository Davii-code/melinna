import { MelinnaError } from '../../core/errors';
import type { PromptScope } from '../../core/prompts/types';
import { hasControlChars, normalizeNewlines } from '../../core/prompts/variables';
import { LIMITS, type SendInput } from '../../shared/ipc-contract';
import { existing, id, invalid, isObj, str } from './validate-common';

const VARIABLE_NAME = /^[A-Za-z0-9_]+$/;
/** Teto grosseiro: o núcleo aplica os limites exatos (e as mensagens) depois de normalizar as quebras de linha. */
const RAW_BODY_MAX = LIMITS.prompt * 2;

export interface SavePromptArgs {
  id?: string;
  name: string;
  body: string;
  scope: PromptScope;
}

export type ResolveArgs = Omit<SendInput, 'execIds'>;

function controlChars(): MelinnaError {
  return new MelinnaError('INPUT_INVALID', {
    userMessage: 'O prompt contém caracteres de controle; remova-os.',
  });
}

function text(v: unknown, what: string, max: number): string {
  const value = str(v, what, 0, max);
  if (hasControlChars(normalizeNewlines(value))) throw controlChars();
  return value;
}

function scope(v: unknown, groupExists: (id: string) => boolean): PromptScope {
  if (v === 'global') return 'global';
  if (!isObj(v)) throw invalid('escopo');
  return { groupId: existing(v.groupId, 'Workspace', groupExists) };
}

function resolveArgs(v: Record<string, unknown>): ResolveArgs {
  if (!isObj(v.values)) throw invalid('valores');
  const values: Record<string, string> = {};
  for (const [name, raw] of Object.entries(v.values)) {
    if (!VARIABLE_NAME.test(name)) throw invalid('nome de variável');
    values[name] = text(raw, 'valor da variável', LIMITS.promptValue);
  }
  if (!Array.isArray(v.allowEmpty) || v.allowEmpty.length > 100) throw invalid('variáveis vazias');
  const allowEmpty = v.allowEmpty.map((n) => {
    if (typeof n !== 'string' || !VARIABLE_NAME.test(n)) throw invalid('nome de variável');
    return n;
  });
  return { body: text(v.body, 'texto do prompt', RAW_BODY_MAX), values, allowEmpty };
}

export function parseList(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string | undefined] => {
    if (args.length > 1) throw invalid('argumentos');
    return [args[0] === undefined ? undefined : existing(args[0], 'Workspace', groupExists)];
  };
}

export function parseSave(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [SavePromptArgs] => {
    const v = args[0];
    if (args.length !== 1 || !isObj(v)) throw invalid('prompt');
    const out: SavePromptArgs = {
      name: str(v.name, 'nome do prompt', 0, LIMITS.promptName * 4),
      body: text(v.body, 'texto do prompt', RAW_BODY_MAX),
      scope: scope(v.scope, groupExists),
    };
    if (v.id !== undefined) out.id = id(v.id, 'Prompt');
    return [out];
  };
}

export function parsePromptId(args: unknown[]): [string] {
  if (args.length !== 1) throw invalid('argumentos');
  return [id(args[0], 'Prompt')];
}

export function parseGroupArg(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [string] => {
    if (args.length !== 1) throw invalid('argumentos');
    return [existing(args[0], 'Workspace', groupExists)];
  };
}

/** `{ ...valores, execId }`: a sessão precisa existir (a prévia usa os dados dela). */
export function parseResolveOne(execExists: (id: string) => boolean) {
  return (args: unknown[]): [ResolveArgs & { execId: string }] => {
    const v = args[0];
    if (args.length !== 1 || !isObj(v)) throw invalid('envio');
    return [{ ...resolveArgs(v), execId: existing(v.execId, 'Execução', execExists) }];
  };
}

/**
 * `execIds`: 1 a 12 ids distintos. A existência fica para o envio, que devolve `not-found` por destino
 * quando a sessão foi removida entre a escolha e o envio.
 */
export function parseSend(args: unknown[]): [SendInput] {
  const v = args[0];
  if (args.length !== 1 || !isObj(v)) throw invalid('envio');
  if (!Array.isArray(v.execIds) || v.execIds.length < 1 || v.execIds.length > LIMITS.sendTargets) {
    throw invalid('sessões de destino');
  }
  const execIds = v.execIds.map((e) => id(e, 'Execução'));
  if (new Set(execIds).size !== execIds.length) throw invalid('sessões de destino');
  return [{ ...resolveArgs(v), execIds }];
}

export function parseExecIdArg(execExists: (id: string) => boolean) {
  return (args: unknown[]): [string] => {
    if (args.length !== 1) throw invalid('argumentos');
    return [existing(args[0], 'Execução', execExists)];
  };
}

export function parseQueueRemove(execExists: (id: string) => boolean) {
  return (args: unknown[]): [string, string] => {
    if (args.length !== 2) throw invalid('argumentos');
    return [existing(args[0], 'Execução', execExists), id(args[1], 'item da fila')];
  };
}
