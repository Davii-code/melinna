export type OsName = 'win32' | 'darwin' | 'linux';

export interface Platform {
  os: OsName;
  /** Valor da variável PATH. */
  pathEnv: string;
  /** Extensões de PATHEXT em minúsculas, com ponto. Vazio fora do Windows. */
  pathExt: string[];
}
