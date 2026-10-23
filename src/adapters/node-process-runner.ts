import { execFile, spawn } from 'node:child_process';
import type { ProcessRunner, RunOptions, RunResult } from '../core/ports/process-runner';

const MAX_OUTPUT = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

/** No Windows o git lança filhos (git-remote-https, ssh): `taskkill /T` encerra a árvore inteira. */
function killTree(pid: number | undefined, kill: () => void): void {
  if (process.platform === 'win32' && pid !== undefined) {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.on('error', kill);
    return;
  }
  kill();
}

function abortError(): Error {
  const err = new Error('operação cancelada') as NodeJS.ErrnoException;
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}

export class NodeProcessRunner implements ProcessRunner {
  run(file: string, args: string[], opts: RunOptions): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = execFile(
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
          opts.signal?.removeEventListener('abort', onAbort);
          if (opts.signal?.aborted) {
            reject(abortError());
            return;
          }
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
      const onAbort = () => killTree(child.pid, () => child.kill());
      if (opts.signal) {
        if (opts.signal.aborted) onAbort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      const onStderr = opts.onStderr;
      if (onStderr) child.stderr?.on('data', (chunk: Buffer) => onStderr(chunk.toString('utf8')));
    });
  }
}
