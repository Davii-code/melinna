import { describe, expect, it } from 'vitest';
import { HostRegistry } from '../../../src/host/registry';
import { MemoryFileSystem } from '../../support/fakes/file-system';
import { MemoryLogger } from '../../support/fakes/logger';

const entry = { pid: 1, startedAt: 'a', exitCode: null, signal: null, endedAt: null, totalBytes: 0 };

describe('HostRegistry', () => {
  it('writes atomically on spawn and exit', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/h/.keep', '');
    const reg = new HostRegistry(fs, '/h/registry.json', new MemoryLogger());
    await reg.load();
    await reg.set('e1', entry);
    await reg.update('e1', { exitCode: 3, endedAt: 'b', totalBytes: 10 });
    const saved = JSON.parse(fs.readText('/h/registry.json')) as {
      schemaVersion: number;
      processes: Record<string, unknown>;
    };
    expect(saved).toEqual({
      schemaVersion: 1,
      processes: { e1: { ...entry, exitCode: 3, endedAt: 'b', totalBytes: 10 } },
    });
    expect(await fs.exists('/h/registry.json.tmp')).toBe(false);
    expect(fs.fsyncCount).toBe(2);
  });

  it('tolerates a missing or corrupted file', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/h/registry.json', '{ruim');
    const reg = new HostRegistry(fs, '/h/registry.json', new MemoryLogger());
    expect(await reg.load()).toEqual({ schemaVersion: 1, processes: {} });
    const empty = new HostRegistry(new MemoryFileSystem(), '/x/registry.json', new MemoryLogger());
    expect((await empty.load()).processes).toEqual({});
  });

  it('ignores updates for unknown executions', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/h/.keep', '');
    const reg = new HostRegistry(fs, '/h/registry.json', new MemoryLogger());
    await reg.update('nada', { exitCode: 1 });
    expect(await fs.exists('/h/registry.json')).toBe(false);
  });
});
