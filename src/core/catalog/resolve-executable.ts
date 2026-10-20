import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { Platform } from '../ports/platform';

async function isFile(fs: FileSystem, p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile;
  } catch {
    return false;
  }
}

/** Resolve um comando para caminho absoluto: caminho absoluto existente, ou busca no PATH (com PATHEXT no Windows). */
export async function resolveExecutable(
  command: string,
  platform: Platform,
  fs: FileSystem,
): Promise<string | null> {
  const p = pathModule(platform.os);
  const win = platform.os === 'win32';
  const candidatesFor = (base: string): string[] => {
    if (!win) return [base];
    const ext = p.extname(base).toLowerCase();
    const hasKnownExt = ext !== '' && platform.pathExt.includes(ext);
    return hasKnownExt ? [base] : platform.pathExt.map((e) => base + e);
  };
  if (p.isAbsolute(command)) {
    for (const c of candidatesFor(command)) if (await isFile(fs, c)) return c;
    return null;
  }
  if (command.includes('/') || (win && command.includes('\\'))) return null;
  const dirs = platform.pathEnv.split(win ? ';' : ':').filter((d) => d.length > 0 && p.isAbsolute(d));
  for (const dir of dirs) {
    for (const c of candidatesFor(p.join(dir.replace(/^"(.*)"$/, '$1'), command))) {
      if (await isFile(fs, c)) return c;
    }
  }
  return null;
}

export function isBatchFile(path: string): boolean {
  return /\.(cmd|bat)$/i.test(path);
}
