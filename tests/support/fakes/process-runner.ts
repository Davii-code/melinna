import type { ProcessRunner, RunOptions, RunResult } from '../../../src/core/ports/process-runner';

export interface RecordedRun {
  file: string;
  args: string[];
  opts: RunOptions;
}

export type RunHandler = (
  file: string,
  args: string[],
  opts: RunOptions,
) => RunResult | Promise<RunResult> | undefined;

const encoder = new TextEncoder();

export function ok(stdout = '', stderr = ''): RunResult {
  return { exitCode: 0, stdout: encoder.encode(stdout), stderr: encoder.encode(stderr) };
}

export function failed(exitCode: number, stderr = ''): RunResult {
  return { exitCode, stdout: new Uint8Array(), stderr: encoder.encode(stderr) };
}

/** Runner programável: o primeiro handler que devolver resultado vence; sem handler, rejeita com ENOENT. */
export class FakeProcessRunner implements ProcessRunner {
  readonly calls: RecordedRun[] = [];
  private handlers: RunHandler[] = [];

  on(handler: RunHandler): this {
    this.handlers.push(handler);
    return this;
  }

  /** Responde quando `file` e o prefixo de `args` coincidem. */
  when(file: string, argsPrefix: string[], result: RunResult | ((args: string[]) => RunResult)): this {
    return this.on((f, args) => {
      if (f !== file) return undefined;
      if (!argsPrefix.every((a, i) => args[i] === a)) return undefined;
      return typeof result === 'function' ? result(args) : result;
    });
  }

  async run(file: string, args: string[], opts: RunOptions): Promise<RunResult> {
    this.calls.push({ file, args: [...args], opts });
    for (const h of this.handlers) {
      const r = await h(file, args, opts);
      if (r) return r;
    }
    const err = new Error(`spawn ${file} ENOENT`) as Error & { code: string };
    err.code = 'ENOENT';
    throw err;
  }
}
