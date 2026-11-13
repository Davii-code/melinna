import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { constants } from 'node:fs';
import { MelinnaError } from '../core/errors';
import type { ProtocolProcess, ProtocolProcessFactory } from '../core/ports/protocol-process';
import { IDE_LIMITS, parseToolStart, type ToolStart } from '../shared/ide-types';

async function resolveProgram(program: string): Promise<string> {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.com'] : [''];
  const candidates = path.isAbsolute(program)
    ? [program]
    : (process.env.PATH ?? '')
        .split(path.delimiter)
        .flatMap((dir) => extensions.map((extension) => path.join(dir, program + extension)));
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return await realpath(candidate);
    } catch {
      /* Tenta o próximo executável no PATH. */
    }
  }
  throw new MelinnaError('PROGRAM_NOT_FOUND', {
    userMessage: 'Executável da ferramenta não encontrado. Informe o caminho completo.',
  });
}

export class NodeProtocolProcessFactory implements ProtocolProcessFactory {
  constructor(private readonly resolve = resolveProgram) {}
  async start(raw: ToolStart): Promise<ProtocolProcess> {
    const input = parseToolStart(raw);
    const file = await this.resolve(input.executable);
    if (/\.(?:cmd|bat|sh|ps1)$/i.test(file)) throw new MelinnaError('UNSAFE_LAUNCHER');
    return new Promise((resolve, reject) => {
      const child = spawn(file, input.args, {
        cwd: input.root,
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const data = new Set<(bytes: Uint8Array) => void>();
      const exits = new Set<() => void>();
      let ended = false;
      let closing = false;
      const buffered: Uint8Array[] = [];
      let bufferedBytes = 0;
      const end = () => {
        if (ended) return;
        ended = true;
        for (const fn of exits) fn();
        exits.clear();
        data.clear();
      };
      const close = () => {
        if (closing || ended) return;
        closing = true;
        child.stdin.destroy();
        if (process.platform === 'win32' && child.pid !== undefined) {
          const killer = spawn(
            path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/pid', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore', shell: false },
          );
          killer.on('error', () => child.kill());
        } else {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
            else child.kill();
          } catch {
            child.kill();
          }
        }
      };
      child.stdout.on('data', (bytes: Buffer) => {
        if (data.size) {
          for (const fn of data) fn(bytes);
        } else {
          bufferedBytes += bytes.length;
          if (bufferedBytes > IDE_LIMITS.message) close();
          else buffered.push(bytes);
        }
      });
      child.stderr.resume();
      child.stdin.on('error', () => {
        close();
        end();
      });
      child.once('error', () => {
        end();
        reject(new MelinnaError('IO_ERROR', { userMessage: 'Não foi possível iniciar a ferramenta.' }));
      });
      child.once('close', end);
      child.once('spawn', () =>
        resolve({
          write(bytes) {
            if (ended || closing || child.stdin.writableLength + bytes.length > IDE_LIMITS.message)
              throw new MelinnaError('IO_ERROR', {
                userMessage: 'A ferramenta não está recebendo mensagens.',
              });
            child.stdin.write(bytes);
          },
          onData(fn) {
            data.add(fn);
            for (const bytes of buffered.splice(0)) fn(bytes);
            bufferedBytes = 0;
            return () => {
              data.delete(fn);
            };
          },
          onExit(fn) {
            if (ended) queueMicrotask(fn);
            else exits.add(fn);
            return () => {
              exits.delete(fn);
            };
          },
          close,
        }),
      );
    });
  }
}
