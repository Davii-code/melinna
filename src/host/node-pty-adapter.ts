import { constants } from 'node:os';
import type { IPty } from 'node-pty';

export interface PtyExit {
  exitCode: number | null;
  signal: string | null;
}

export interface PtyProcess {
  readonly pid: number;
  onData(cb: (data: Uint8Array) => void): void;
  onExit(cb: (e: PtyExit) => void): void;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  pause(): void;
  resume(): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyFactory {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyProcess;
}

const signalNames = new Map<number, string>(
  Object.entries(constants.signals).map(([name, num]) => [num, name]),
);

export function signalName(signal: number | undefined): string | null {
  if (!signal) return null;
  return signalNames.get(signal) ?? String(signal);
}

class NodePtyProcess implements PtyProcess {
  constructor(private readonly pty: IPty) {}

  get pid(): number {
    return this.pty.pid;
  }

  onData(cb: (data: Uint8Array) => void): void {
    this.pty.onData((d: string | Buffer) => cb(typeof d === 'string' ? Buffer.from(d, 'utf8') : d));
  }

  onExit(cb: (e: PtyExit) => void): void {
    this.pty.onExit(({ exitCode, signal }) => {
      const sig = signalName(signal);
      cb({ exitCode: sig ? null : exitCode, signal: sig });
    });
  }

  write(data: Uint8Array): void {
    this.pty.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }

  resize(cols: number, rows: number): void {
    this.pty.resize(cols, rows);
  }

  pause(): void {
    this.pty.pause();
  }

  resume(): void {
    this.pty.resume();
  }

  kill(signal?: string): void {
    this.pty.kill(signal);
  }
}

/** Lança processos no PTY com node-pty (ConPTY no Windows). Nunca usa shell: `file` é absoluto e `args` é um vetor. */
export class NodePtyFactory implements PtyFactory {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyProcess {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePty = require('node-pty') as typeof import('node-pty');
    const pty = nodePty.spawn(file, args, {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env,
      // Bytes crus no POSIX; o ConPTY entrega texto UTF-8.
      encoding: process.platform === 'win32' ? 'utf8' : null,
    } as Parameters<typeof nodePty.spawn>[2]);
    return new NodePtyProcess(pty);
  }
}
