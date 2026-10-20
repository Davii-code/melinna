import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { Platform } from '../ports/platform';
import { resolveExecutable } from './resolve-executable';

export interface ResolvedLauncher {
  file: string;
  prefixArgs: string[];
}

async function exists(fs: FileSystem, p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile;
  } catch {
    return false;
  }
}

/**
 * Resolve o alvo real de um shim `.cmd` do npm sem passar por cmd.exe:
 * lê `bin` do package.json do pacote ao lado do shim e devolve o `.exe` nativo ou `node <script>`.
 */
export async function resolveNpmShim(
  shimPath: string,
  shim: { package: string; bin: string },
  platform: Platform,
  fs: FileSystem,
): Promise<ResolvedLauncher | null> {
  const p = pathModule(platform.os);
  const shimDir = p.dirname(shimPath);
  const pkgDir = p.join(shimDir, 'node_modules', ...shim.package.split('/'));
  let manifest: unknown;
  try {
    manifest = JSON.parse(new TextDecoder().decode(await fs.readFile(p.join(pkgDir, 'package.json'))));
  } catch {
    return null;
  }
  if (typeof manifest !== 'object' || manifest === null) return null;
  const bin = (manifest as { bin?: unknown }).bin;
  const rel =
    typeof bin === 'string'
      ? bin
      : typeof bin === 'object' && bin !== null
        ? (bin as Record<string, unknown>)[shim.bin]
        : undefined;
  if (typeof rel !== 'string') return null;
  const script = p.resolve(pkgDir, rel);
  if (p.relative(pkgDir, script).startsWith('..')) return null;
  if (!(await exists(fs, script))) return null;
  if (/\.exe$/i.test(script)) return { file: script, prefixArgs: [] };
  const localNode = p.join(shimDir, platform.os === 'win32' ? 'node.exe' : 'node');
  const node = (await exists(fs, localNode)) ? localNode : await resolveExecutable('node', platform, fs);
  if (!node || /\.(cmd|bat)$/i.test(node)) return null;
  return { file: node, prefixArgs: [script] };
}
