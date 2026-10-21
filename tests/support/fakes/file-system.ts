import { dirname, resolve, sep } from 'node:path';
import type { FileStat, FileSystem } from '../../../src/core/ports/file-system';

type Op = keyof FileSystem;

interface Injection {
  op: Op | '*';
  match: (p: string) => boolean;
  code: string;
  times: number;
}

function fsError(code: string, p: string): Error {
  const err = new Error(`${code}: ${p}`) as Error & { code: string };
  err.code = code;
  return err;
}

const encoder = new TextEncoder();

/** Sistema de arquivos em memória com injeção de erro por caminho e código. */
export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>();
  private injections: Injection[] = [];
  fsyncCount = 0;

  constructor() {
    this.dirs.add(resolve('/'));
  }

  /** Faz a operação falhar com `code` para caminhos que casam; `times` = quantas vezes (padrão: sempre). */
  failOn(op: Op | '*', match: string | ((p: string) => boolean), code: string, times = Infinity): void {
    const m = typeof match === 'string' ? (p: string) => p === resolve(match) : match;
    this.injections.push({ op, match: m, code, times });
  }

  clearFailures(): void {
    this.injections = [];
  }

  private check(op: Op, p: string): void {
    const inj = this.injections.find((i) => (i.op === op || i.op === '*') && i.times > 0 && i.match(p));
    if (inj) {
      inj.times--;
      throw fsError(inj.code, p);
    }
  }

  private ensureParent(p: string): void {
    if (!this.dirs.has(dirname(p))) throw fsError('ENOENT', p);
  }

  readText(p: string): string {
    const data = this.files.get(resolve(p));
    if (!data) throw fsError('ENOENT', p);
    return new TextDecoder().decode(data);
  }

  seed(p: string, data: string | Uint8Array): void {
    const abs = resolve(p);
    let d = dirname(abs);
    while (!this.dirs.has(d)) {
      this.dirs.add(d);
      d = dirname(d);
    }
    this.files.set(abs, typeof data === 'string' ? encoder.encode(data) : data);
  }

  async readFile(p: string): Promise<Uint8Array> {
    const abs = resolve(p);
    this.check('readFile', abs);
    const data = this.files.get(abs);
    if (!data) throw fsError('ENOENT', abs);
    return data.slice();
  }

  async writeFile(p: string, data: Uint8Array | string, opts?: { flag?: 'w' | 'wx' | 'a' }): Promise<void> {
    const abs = resolve(p);
    this.check('writeFile', abs);
    this.ensureParent(abs);
    const bytes = typeof data === 'string' ? encoder.encode(data) : data.slice();
    const flag = opts?.flag ?? 'w';
    if (flag === 'wx' && (this.files.has(abs) || this.dirs.has(abs))) throw fsError('EEXIST', abs);
    if (flag === 'a') {
      const prev = this.files.get(abs) ?? new Uint8Array();
      const next = new Uint8Array(prev.length + bytes.length);
      next.set(prev);
      next.set(bytes, prev.length);
      this.files.set(abs, next);
      return;
    }
    this.files.set(abs, bytes);
  }

  async appendFile(p: string, data: Uint8Array): Promise<void> {
    const abs = resolve(p);
    this.check('appendFile', abs);
    this.ensureParent(abs);
    const prev = this.files.get(abs) ?? new Uint8Array();
    const next = new Uint8Array(prev.length + data.length);
    next.set(prev);
    next.set(data, prev.length);
    this.files.set(abs, next);
  }

  async rename(from: string, to: string): Promise<void> {
    const a = resolve(from);
    const b = resolve(to);
    this.check('rename', a);
    const data = this.files.get(a);
    if (!data) throw fsError('ENOENT', a);
    this.ensureParent(b);
    this.files.delete(a);
    this.files.set(b, data);
  }

  async rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const abs = resolve(p);
    this.check('rm', abs);
    if (this.files.delete(abs)) return;
    if (this.dirs.has(abs)) {
      const prefix = abs.endsWith(sep) ? abs : `${abs}${sep}`;
      const children = [...this.files.keys(), ...this.dirs].filter((k) => k.startsWith(prefix));
      if (children.length > 0 && !opts?.recursive) throw fsError('ENOTEMPTY', abs);
      for (const k of children) {
        this.files.delete(k);
        this.dirs.delete(k);
      }
      this.dirs.delete(abs);
      return;
    }
    if (!opts?.force) throw fsError('ENOENT', abs);
  }

  async mkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
    const abs = resolve(p);
    this.check('mkdir', abs);
    if (this.dirs.has(abs)) {
      if (opts?.recursive) return;
      throw fsError('EEXIST', abs);
    }
    if (!opts?.recursive) {
      this.ensureParent(abs);
      this.dirs.add(abs);
      return;
    }
    let d = abs;
    const toAdd: string[] = [];
    while (!this.dirs.has(d)) {
      toAdd.push(d);
      d = dirname(d);
    }
    for (const x of toAdd) this.dirs.add(x);
  }

  async readdir(p: string): Promise<string[]> {
    const abs = resolve(p);
    this.check('readdir', abs);
    if (!this.dirs.has(abs)) throw fsError('ENOENT', abs);
    const names = new Set<string>();
    for (const k of [...this.files.keys(), ...this.dirs]) {
      if (k !== abs && dirname(k) === abs) names.add(k.slice(abs.length + (abs.endsWith('/') ? 0 : 1)));
    }
    return [...names].sort();
  }

  async stat(p: string): Promise<FileStat> {
    const abs = resolve(p);
    this.check('stat', abs);
    const f = this.files.get(abs);
    if (f) return { size: f.length, isFile: true, isDirectory: false };
    if (this.dirs.has(abs)) return { size: 0, isFile: false, isDirectory: true };
    throw fsError('ENOENT', abs);
  }

  async exists(p: string): Promise<boolean> {
    const abs = resolve(p);
    this.check('exists', abs);
    return this.files.has(abs) || this.dirs.has(abs);
  }

  async fsyncFile(p: string): Promise<void> {
    const abs = resolve(p);
    this.check('fsyncFile', abs);
    if (!this.files.has(abs)) throw fsError('ENOENT', abs);
    this.fsyncCount++;
  }
}
