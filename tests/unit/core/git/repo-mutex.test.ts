import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('KeyedMutex', () => {
  it('runs tasks with the same key one at a time in FIFO order', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string) =>
      m.run('repo', async () => {
        log.push(`start ${name}`);
        await tick();
        log.push(`end ${name}`);
        return name;
      });
    const results = await Promise.all([task('a'), task('b'), task('c')]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
    expect(m.isLocked('repo')).toBe(false);
  });

  it('releases on error', async () => {
    const m = new KeyedMutex();
    await expect(m.run('k', async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await m.run('k', async () => 1)).toBe(1);
  });

  it('does not block different keys', async () => {
    const m = new KeyedMutex();
    const log: string[] = [];
    let releaseA!: () => void;
    const a = m.run('a', () => new Promise<void>((r) => (releaseA = r)).then(() => log.push('a')));
    await m.run('b', async () => log.push('b'));
    releaseA();
    await a;
    expect(log).toEqual(['b', 'a']);
  });
});
