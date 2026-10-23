import { MelinnaError } from '../errors';
import type { Logger } from '../ports/logger';
import type { ProcessRunner } from '../ports/process-runner';

const STDERR_LIMIT = 2048;
const decoder = new TextDecoder();

export interface GitOptions {
  cwd: string;
  /** Leitura: acrescenta `--no-optional-locks` para não tocar o índice. */
  read?: boolean;
  /** Não lança em código de saída diferente de zero. */
  allowFail?: boolean;
  timeoutMs?: number;
  /** Variáveis extras de ambiente, por cima das fixas (`GIT_TERMINAL_PROMPT`, `LC_ALL`). */
  env?: Record<string, string>;
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stdoutBytes: Uint8Array;
  stderr: string;
}

export function truncate(text: string, limit = STDERR_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Executa git sempre por execFile. Logs registram só o subcomando, nunca argumentos do usuário. */
export class GitRunner {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly log: Logger,
    private readonly gitPath = 'git',
  ) {}

  async run(args: string[], opts: GitOptions): Promise<GitResult> {
    const full = ['-c', 'core.quotepath=off', ...(opts.read ? ['--no-optional-locks'] : []), ...args];
    const subcommand = args[0] ?? '';
    const started = Date.now();
    let res;
    try {
      res = await this.runner.run(this.gitPath, full, {
        cwd: opts.cwd,
        timeoutMs: opts.timeoutMs ?? 120_000,
        env: { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C', ...opts.env },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onStderr ? { onStderr: opts.onStderr } : {}),
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      this.log.error('git.spawn_failed', { command: subcommand, err: cause });
      throw new MelinnaError('GIT_FAILED', {
        userMessage: 'Não foi possível executar o git. Verifique se ele está instalado e no PATH.',
        details: { command: subcommand },
        cause,
      });
    }
    const stdout = decoder.decode(res.stdout);
    const stderr = decoder.decode(res.stderr);
    if (res.exitCode !== 0 && !opts.allowFail) {
      const stderrShort = truncate(stderr);
      this.log.warn('git.failed', {
        command: subcommand,
        code: res.exitCode,
        stderr: stderrShort,
        durationMs: Date.now() - started,
      });
      throw new MelinnaError('GIT_FAILED', {
        userMessage: `O comando git ${subcommand} falhou: ${truncate(stderr.trim(), 300) || `código ${res.exitCode}`}`,
        details: { command: subcommand, exitCode: res.exitCode, stderr: stderrShort },
      });
    }
    return { exitCode: res.exitCode, stdout, stdoutBytes: res.stdout, stderr };
  }
}
