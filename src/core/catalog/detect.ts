import type { DetectResult } from '../api-types';
import { MelinnaError } from '../errors';
import type { FileSystem } from '../ports/file-system';
import type { Platform } from '../ports/platform';
import { resolveNpmShim, type ResolvedLauncher } from './npm-shim';
import { isBatchFile, resolveExecutable } from './resolve-executable';
import type { AgentDefinition } from './schema';

export type { DetectResult };

export function commandFor(def: AgentDefinition, platform: Platform): string {
  return platform.os === 'win32' && def.executable.windows?.command
    ? def.executable.windows.command
    : def.executable.command;
}

/**
 * Resolve o executável a lançar. Nunca devolve `.cmd`/`.bat` como `file`:
 * no Windows, esses lançadores são resolvidos pelo shim npm declarado, ou recusados.
 */
export async function resolveLauncher(
  def: AgentDefinition,
  platform: Platform,
  fs: FileSystem,
): Promise<ResolvedLauncher> {
  const command = commandFor(def, platform);
  const resolved = await resolveExecutable(command, platform, fs);
  if (!resolved) {
    throw new MelinnaError('EXECUTABLE_NOT_FOUND', {
      userMessage: `Executável ${command} não encontrado.`,
      details: { command },
    });
  }
  if (!isBatchFile(resolved)) return { file: resolved, prefixArgs: [] };
  const shim = def.executable.windows?.npmShim;
  const target = shim ? await resolveNpmShim(resolved, shim, platform, fs) : null;
  if (!target || isBatchFile(target.file)) {
    throw new MelinnaError('UNSAFE_LAUNCHER', {
      userMessage: `Não é possível lançar ${command} com segurança.`,
      details: { command },
    });
  }
  return target;
}

export async function detect(
  def: AgentDefinition,
  platform: Platform,
  fs: FileSystem,
): Promise<DetectResult> {
  const searched = commandFor(def, platform);
  try {
    const launcher = await resolveLauncher(def, platform, fs);
    return { installed: true, searched, resolvedPath: launcher.prefixArgs[0] ?? launcher.file };
  } catch (err) {
    if (err instanceof MelinnaError) return { installed: false, searched, reason: err.userMessage };
    throw err;
  }
}
