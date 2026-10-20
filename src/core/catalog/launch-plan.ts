import { MelinnaError } from '../errors';
import type { OsName } from '../ports/platform';
import { substituteArgs } from './placeholders';
import { CUSTOM_MODEL_RE, type AgentDefinition } from './schema';

/** Limite prático da linha de comando no Windows (o máximo do sistema é 32.767). */
export const WINDOWS_CMDLINE_LIMIT = 30_000;

export interface LaunchSelection {
  model: string | null;
  permission: string | null;
  prompt: string;
  resume?: boolean;
}

export interface ArgsPlan {
  args: string[];
  promptViaPty?: string;
  model: string | null;
  permission: string | null;
}

export function resolveModel(def: AgentDefinition, requested: string | null): string | null {
  if (!def.model) return null;
  const value = requested ?? def.model.default;
  if (def.model.options.some((o) => o.id === value)) return value;
  if (!def.model.allowCustom) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `O modelo ${value} não está na lista deste agente.`,
    });
  }
  if (!CUSTOM_MODEL_RE.test(value)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: 'Nome de modelo inválido: use letras, números e . _ : / @ - (até 100 caracteres).',
    });
  }
  return value;
}

export function resolvePermission(def: AgentDefinition, requested: string | null): string | null {
  if (!def.permission) return null;
  const value = requested ?? def.permission.default;
  if (!def.permission.options.some((o) => o.id === value)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `O modo de permissão ${value} não existe para este agente.`,
    });
  }
  return value;
}

/** Comprimento aproximado da linha de comando montada pelo CommandLineToArgvW (com aspas e escapes). */
export function windowsCommandLineLength(file: string, args: readonly string[]): number {
  return [file, ...args].reduce((n, a) => n + a.length * 2 + 3, 0);
}

/**
 * Monta o vetor de argumentos na ordem do contrato:
 * args + permissão + modelo + (retomada) + enunciado.
 * `prefixArgs` vem da resolução do executável (ex.: o script do shim npm).
 */
export function buildLaunchArgs(
  def: AgentDefinition,
  sel: LaunchSelection,
  opts: { os: OsName; file: string; prefixArgs?: readonly string[] },
): ArgsPlan {
  if (sel.prompt.includes('\0')) throw new MelinnaError('PROMPT_INVALID');
  const model = resolveModel(def, sel.model);
  const permission = resolvePermission(def, sel.permission);
  const values = { '{model}': model ?? '', '{permission}': permission ?? '', '{prompt}': sel.prompt };

  const head = [...(opts.prefixArgs ?? []), ...def.args];
  const permArgs = def.permission?.options.find((o) => o.id === permission)?.args ?? [];
  const modelArgs = def.model ? def.model.args : [];
  const resumeArgs = sel.resume && def.resume ? def.resume.args : [];
  const base = [
    ...head,
    ...substituteArgs(permArgs, values),
    ...substituteArgs(modelArgs, values),
    ...resumeArgs,
  ];

  const plan: ArgsPlan = { args: base, model, permission };
  const prompt = sel.prompt;
  if (prompt.length === 0 || def.prompt.delivery === 'none') return plan;
  if (def.prompt.delivery === 'pty') return { ...plan, promptViaPty: prompt };

  const withPrompt = [...base, ...substituteArgs(def.prompt.args, values)];
  if (opts.os === 'win32' && windowsCommandLineLength(opts.file, withPrompt) > WINDOWS_CMDLINE_LIMIT) {
    return { ...plan, promptViaPty: prompt };
  }
  return { ...plan, args: withPrompt };
}
