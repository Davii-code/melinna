import { MelinnaError } from '../errors';
import type { OsName } from '../ports/platform';
import { substituteArgs } from './placeholders';
import { CUSTOM_MODEL_RE, type AgentDefinition } from './schema';

/** Limite prático da linha de comando no Windows (o máximo do sistema é 32.767). */
export const WINDOWS_CMDLINE_LIMIT = 30_000;

/** Limite prático dos argumentos no Linux: margem conservadora abaixo do ARG_MAX típico (2 MiB). */
export const POSIX_ARGS_LIMIT = 131_072;

export const CMDLINE_TOO_LONG_MESSAGE =
  'Pastas demais para abrir este agente de uma vez; remova algumas do workspace.';

export interface LaunchSelection {
  model: string | null;
  permission: string | null;
  prompt: string;
  resume?: boolean;
  /** Pastas extras do workspace (além do cwd); só chegam ao agente que declara `extraDirs`. */
  extraDirs?: readonly string[];
}

export interface ArgsPlan {
  args: string[];
  promptViaPty?: string;
  model: string | null;
  permission: string | null;
  /** O agente declara `extraDirs` e ao menos uma pasta foi para a linha de comando. */
  extraDirsApplied: boolean;
  /** Pastas que o agente aceitaria, mas que o estilo `join` não consegue passar (contêm o separador). */
  extraDirsOmitted: number;
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

function commandLineLength(os: OsName, file: string, args: readonly string[]): number {
  return os === 'win32'
    ? windowsCommandLineLength(file, args)
    : [file, ...args].reduce((n, a) => n + Buffer.byteLength(a) + 1, 0);
}

function commandLineLimit(os: OsName): number {
  return os === 'win32' ? WINDOWS_CMDLINE_LIMIT : POSIX_ARGS_LIMIT;
}

/** Argumentos das pastas extras, na forma que o agente declara; cada pasta é um item, nunca texto de shell. */
function extraDirsArgs(def: AgentDefinition, dirs: readonly string[]): { args: string[]; omitted: number } {
  const spec = def.extraDirs;
  if (!spec || dirs.length === 0) return { args: [], omitted: 0 };
  if (spec.style === 'repeat') {
    return { args: dirs.flatMap((dir) => substituteArgs(spec.args, { '{dir}': dir })), omitted: 0 };
  }
  const usable = dirs.filter((dir) => !dir.includes(spec.separator));
  const omitted = dirs.length - usable.length;
  if (usable.length === 0) return { args: [], omitted };
  return { args: substituteArgs(spec.args, { '{dirs}': usable.join(spec.separator) }), omitted };
}

/**
 * Monta o vetor de argumentos na ordem do contrato:
 * args + pastas extras + permissão + modelo + (retomada) + enunciado.
 * As pastas extras vêm antes das demais opções porque a opção de pastas de alguns agentes é variádica e
 * engoliria o argumento seguinte se ele não fosse outra opção.
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
  const extra = extraDirsArgs(def, sel.extraDirs ?? []);
  const permArgs = def.permission?.options.find((o) => o.id === permission)?.args ?? [];
  const modelArgs = def.model ? def.model.args : [];
  const resumeArgs = sel.resume && def.resume ? def.resume.args : [];
  const base = [
    ...head,
    ...extra.args,
    ...substituteArgs(permArgs, values),
    ...substituteArgs(modelArgs, values),
    ...resumeArgs,
  ];

  if (extra.args.length > 0 && commandLineLength(opts.os, opts.file, base) > commandLineLimit(opts.os)) {
    throw new MelinnaError('INPUT_INVALID', { userMessage: CMDLINE_TOO_LONG_MESSAGE });
  }
  const plan: ArgsPlan = {
    args: base,
    model,
    permission,
    extraDirsApplied: extra.args.length > 0,
    extraDirsOmitted: extra.omitted,
  };
  const prompt = sel.prompt;
  if (prompt.length === 0 || def.prompt.delivery === 'none') return plan;
  if (def.prompt.delivery === 'pty') return { ...plan, promptViaPty: prompt };

  const withPrompt = [...base, ...substituteArgs(def.prompt.args, values)];
  if (opts.os === 'win32' && windowsCommandLineLength(opts.file, withPrompt) > WINDOWS_CMDLINE_LIMIT) {
    return { ...plan, promptViaPty: prompt };
  }
  return { ...plan, args: withPrompt };
}
