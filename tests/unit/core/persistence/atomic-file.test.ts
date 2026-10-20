import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../../../../src/core/persistence/atomic-file';
import { MemoryFileSystem } from '../../../support/fakes/file-system';

describe('writeFileAtomic', () => {
  it('writes through a tmp file with fsync and rename', async () => {
    const fs = new MemoryFileSystem();
    await writeFileAtomic(fs, '/state.json', '{"a":1}');
    expect(fs.readText('/state.json')).toBe('{"a":1}');
    expect(await fs.exists('/state.json.tmp')).toBe(false);
    expect(fs.fsyncCount).toBe(1);
  });

  it('keeps the original and removes tmp when writing fails', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/state.json', 'old');
    fs.failOn('fsyncFile', '/state.json.tmp', 'EIO');
    await expect(writeFileAtomic(fs, '/state.json', 'new')).rejects.toMatchObject({ code: 'EIO' });
    expect(fs.readText('/state.json')).toBe('old');
    expect(await fs.exists('/state.json.tmp')).toBe(false);
  });

  it('keeps the original when rename fails', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/state.json', 'old');
    fs.failOn('rename', '/state.json.tmp', 'ENOSPC');
    await expect(writeFileAtomic(fs, '/state.json', 'new')).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(fs.readText('/state.json')).toBe('old');
    expect(await fs.exists('/state.json.tmp')).toBe(false);
  });
});
