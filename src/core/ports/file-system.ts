export interface FileStat {
  size: number;
  isFile: boolean;
  isDirectory: boolean;
}

/** Subconjunto de fs/promises usado pelo núcleo. Erros preservam `code` (ENOENT, EEXIST, ENOSPC…). */
export interface FileSystem {
  readFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, data: Uint8Array | string, opts?: { flag?: 'w' | 'wx' | 'a' }): Promise<void>;
  appendFile(p: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  mkdir(p: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(p: string): Promise<string[]>;
  stat(p: string): Promise<FileStat>;
  exists(p: string): Promise<boolean>;
  fsyncFile(p: string): Promise<void>;
  /** Caminho canônico, com links simbólicos e juncões resolvidos; falha se não existir. */
  realpath(p: string): Promise<string>;
}

export function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
