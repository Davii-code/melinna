import type { FileSystem } from '../ports/file-system';
import type { LogSink } from './logger';

export interface JsonlSinkOptions {
  maxBytes?: number;
  maxFiles?: number;
}

const encoder = new TextEncoder();

/**
 * Grava uma linha por registro em `path`, com rotação: `path` → `path.1` → … até `maxFiles` arquivos.
 * As gravações são serializadas; falhas de disco não propagam para quem registra.
 */
export class JsonlSink implements LogSink {
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private size: number | undefined;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: FileSystem,
    private readonly path: string,
    opts: JsonlSinkOptions = {},
  ) {
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 3;
  }

  write(line: string): void {
    const bytes = encoder.encode(`${line}\n`);
    this.chain = this.chain.then(() => this.append(bytes)).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.chain;
  }

  private async append(bytes: Uint8Array): Promise<void> {
    if (this.size === undefined) {
      this.size = (await this.fs.exists(this.path)) ? (await this.fs.stat(this.path)).size : 0;
    }
    if (this.size > 0 && this.size + bytes.length > this.maxBytes) {
      await this.rotate();
      this.size = 0;
    }
    await this.fs.appendFile(this.path, bytes);
    this.size += bytes.length;
  }

  private async rotate(): Promise<void> {
    const oldest = `${this.path}.${this.maxFiles - 1}`;
    if (await this.fs.exists(oldest)) await this.fs.rm(oldest, { force: true });
    for (let i = this.maxFiles - 2; i >= 1; i--) {
      const from = `${this.path}.${i}`;
      if (await this.fs.exists(from)) await this.fs.rename(from, `${this.path}.${i + 1}`);
    }
    await this.fs.rename(this.path, `${this.path}.1`);
  }
}
