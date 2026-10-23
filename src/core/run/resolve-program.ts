import { isBatchFile, resolveExecutable } from '../catalog/resolve-executable';
import { resolveNpmShim } from '../catalog/npm-shim';
import { MelinnaError } from '../errors';
import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { Platform } from '../ports/platform';

export const BATCH_PROGRAM_MESSAGE = 'Este programa só roda pelo prompt de comando; use o executável.';

/** Lotes do npm, pnpm e yarn que o app resolve sem `cmd.exe`: lê o pacote ao lado do lote e roda `node`. */
const NPM_SHIMS: Readonly<Record<string, { package: string; bin: string }>> = {
  npm: { package: 'npm', bin: 'npm' },
  pnpm: { package: 'pnpm', bin: 'pnpm' },
  yarn: { package: 'yarn', bin: 'yarn' },
};

export interface ResolvedProgram {
  /** Caminho absoluto do que será lançado; nunca um `.cmd`/`.bat`. */
  file: string;
  /** Argumentos que vêm antes dos da configuração (ex.: o script do shim do npm). */
  prefixArgs: string[];
  /** Falso quando é um arquivo de POSIX sem o bit de execução (wrapper do projeto copiado sem permissão). */
  executable: boolean;
}

function notFound(program: string): MelinnaError {
  return new MelinnaError('PROGRAM_NOT_FOUND', {
    userMessage: `Programa não encontrado: ${program}.`,
    details: { program },
  });
}

/**
 * Resolve o programa de uma configuração para algo que o hospedeiro lança direto, sem shell: executável no
 * PATH (ou caminho absoluto), shim do npm/pnpm/yarn no Windows, nada além disso. Qualquer outro lote é
 * recusado.
 */
export async function resolveProgram(
  program: string,
  platform: Platform,
  fs: FileSystem,
): Promise<ResolvedProgram> {
  const resolved = await resolveExecutable(program, platform, fs);
  if (!resolved) throw notFound(program);
  if (isBatchFile(resolved)) {
    const p = pathModule(platform.os);
    const name = p
      .basename(resolved)
      .replace(/\.(cmd|bat)$/i, '')
      .toLowerCase();
    const shim = NPM_SHIMS[name];
    const target = shim ? await resolveNpmShim(resolved, shim, platform, fs) : null;
    if (!target || isBatchFile(target.file)) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: BATCH_PROGRAM_MESSAGE });
    }
    return { file: target.file, prefixArgs: target.prefixArgs, executable: true };
  }
  let executable = true;
  if (platform.os !== 'win32') {
    const mode = (await fs.stat(resolved).catch(() => null))?.mode;
    executable = mode === undefined || (mode & 0o111) !== 0;
  }
  return { file: resolved, prefixArgs: [], executable };
}

/** O programa pode ser lançado agora? `searched` é o que o usuário vê em "não encontrado: X". */
export async function checkProgram(
  program: string,
  platform: Platform,
  fs: FileSystem,
): Promise<{ available: boolean; searched: string }> {
  try {
    await resolveProgram(program, platform, fs);
    return { available: true, searched: program };
  } catch (err) {
    if (err instanceof MelinnaError) return { available: false, searched: program };
    throw err;
  }
}
