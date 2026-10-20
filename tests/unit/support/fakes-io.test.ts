import { describe, expect, it } from 'vitest';
import { errorCode } from '../../../src/core/ports/file-system';
import { MemoryFileSystem } from '../../support/fakes/file-system';
import { FakeProcessRunner, failed, ok } from '../../support/fakes/process-runner';

describe('MemoryFileSystem', () => {
  it('writes, reads, lists, renames and removes', async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir('/a/b', { recursive: true });
    await fs.writeFile('/a/b/x.txt', 'oi');
    await fs.appendFile('/a/b/x.txt', new TextEncoder().encode('!'));
    expect(fs.readText('/a/b/x.txt')).toBe('oi!');
    expect(await fs.readdir('/a')).toEqual(['b']);
    expect(await fs.stat('/a/b/x.txt')).toEqual({ size: 3, isFile: true, isDirectory: false });
    await fs.rename('/a/b/x.txt', '/a/y.txt');
    expect(await fs.exists('/a/b/x.txt')).toBe(false);
    await fs.rm('/a', { recursive: true });
    expect(await fs.exists('/a/y.txt')).toBe(false);
  });

  it('enforces wx exclusivity and missing parents', async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile('/l', 'a', { flag: 'wx' });
    await expect(fs.writeFile('/l', 'b', { flag: 'wx' })).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(fs.writeFile('/no/such/file', 'x')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('injects errors by path and code, a limited number of times', async () => {
    const fs = new MemoryFileSystem();
    fs.failOn('appendFile', '/seg', 'ENOSPC', 1);
    await expect(fs.appendFile('/seg', new Uint8Array([1]))).rejects.toMatchObject({ code: 'ENOSPC' });
    await fs.appendFile('/seg', new Uint8Array([1]));
    expect((await fs.readFile('/seg')).length).toBe(1);
    try {
      await fs.readFile('/nada');
    } catch (err) {
      expect(errorCode(err)).toBe('ENOENT');
    }
  });
});

describe('FakeProcessRunner', () => {
  it('matches by file and args prefix and records calls', async () => {
    const r = new FakeProcessRunner()
      .when('git', ['rev-parse'], ok('abc\n'))
      .when('git', [], failed(1, 'boom'));
    expect(new TextDecoder().decode((await r.run('git', ['rev-parse', 'HEAD'], {})).stdout)).toBe('abc\n');
    expect((await r.run('git', ['status'], { cwd: '/r' })).exitCode).toBe(1);
    await expect(r.run('nope', [], {})).rejects.toMatchObject({ code: 'ENOENT' });
    expect(r.calls.map((c) => c.args[0])).toEqual(['rev-parse', 'status', undefined]);
    expect(r.calls[1]?.opts.cwd).toBe('/r');
  });
});
