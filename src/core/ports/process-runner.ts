export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
}

/** Executa um programa sem shell. Rejeita apenas se o programa não pôde ser iniciado ou estourou o tempo. */
export interface ProcessRunner {
  run(file: string, args: string[], opts: RunOptions): Promise<RunResult>;
}
