export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Aborta o processo (e os filhos dele); a promessa rejeita com um erro de nome `AbortError`. */
  signal?: AbortSignal;
  /** Recebe a saída de erro conforme chega (progresso do git); a saída completa continua no resultado. */
  onStderr?: (chunk: string) => void;
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
