import { execFile } from 'node:child_process';
import type { ProcessRunner, RunOptions, RunResult } from '../core/ports/process-runner';

const MAX_OUTPUT = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

export class NodeProcessRunner implements ProcessRunner {
  run(file: string, args: string[], opts: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        {
          cwd: opts.cwd,
          env: opts.env ? { ...process.env, ...opts.env } : process.env,
          timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT,
          encoding: 'buffer',
          shell: false,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          if (error) {
            const e = error as NodeJS.ErrnoException & { killed?: boolean; code?: string | number };
            if (typeof e.code === 'number') {
              resolve({ exitCode: e.code, stdout, stderr });
              return;
            }
            if (e.killed) {
              const timeout = new Error(`timeout ao executar ${file}`) as NodeJS.ErrnoException;
              timeout.code = 'ETIMEDOUT';
              reject(timeout);
              return;
            }
            reject(error);
            return;
          }
          resolve({ exitCode: 0, stdout, stderr });
        },
      );
    });
  }
}
