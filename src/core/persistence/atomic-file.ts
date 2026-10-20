import type { FileSystem } from '../ports/file-system';

/** Grava `path` de forma atômica: `.tmp` + fsync + rename. Em erro, remove o `.tmp` e mantém o original. */
export async function writeFileAtomic(
  fs: FileSystem,
  path: string,
  data: Uint8Array | string,
): Promise<void> {
  const tmp = `${path}.tmp`;
  try {
    await fs.writeFile(tmp, data);
    await fs.fsyncFile(tmp);
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
