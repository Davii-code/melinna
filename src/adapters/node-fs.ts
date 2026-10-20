import { promises as fsp } from 'node:fs';
import type { FileStat, FileSystem } from '../core/ports/file-system';

export class NodeFileSystem implements FileSystem {
  async readFile(p: string): Promise<Uint8Array> {
    return fsp.readFile(p);
  }
  async writeFile(p: string, data: Uint8Array | string, opts?: { flag?: 'w' | 'wx' | 'a' }): Promise<void> {
    await fsp.writeFile(p, data, { flag: opts?.flag ?? 'w' });
  }
  async appendFile(p: string, data: Uint8Array): Promise<void> {
    await fsp.appendFile(p, data);
  }
  async rename(from: string, to: string): Promise<void> {
    await fsp.rename(from, to);
  }
  async rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fsp.rm(p, { recursive: opts?.recursive ?? false, force: opts?.force ?? false, maxRetries: 3 });
  }
  async mkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
    await fsp.mkdir(p, { recursive: opts?.recursive ?? false });
  }
  async readdir(p: string): Promise<string[]> {
    return (await fsp.readdir(p)).sort();
  }
  async stat(p: string): Promise<FileStat> {
    const s = await fsp.stat(p);
    return { size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory() };
  }
  async exists(p: string): Promise<boolean> {
    try {
      await fsp.lstat(p);
      return true;
    } catch {
      return false;
    }
  }
  async fsyncFile(p: string): Promise<void> {
    const handle = await fsp.open(p, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
