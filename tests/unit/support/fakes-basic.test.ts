import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../support/fakes/clock';
import { MemoryLogger } from '../../support/fakes/logger';
import { fakePlatform } from '../../support/fakes/platform';

describe('MemoryLogger', () => {
  it('records levels, components and fields', () => {
    const log = new MemoryLogger();
    log.info('a', { n: 1 });
    log.child('git').error('b', { err: new Error('x') });
    expect(log.records.map((r) => [r.level, r.component, r.event])).toEqual([
      ['info', 'test', 'a'],
      ['error', 'git', 'b'],
    ]);
    expect(log.text()).toContain('"x"');
  });
});

describe('FakeClock', () => {
  it('fires timers in order only when advanced and supports cancel', () => {
    const clock = new FakeClock(0);
    const fired: string[] = [];
    clock.setTimeout(() => fired.push('b'), 20);
    clock.setTimeout(() => fired.push('a'), 10);
    const cancel = clock.setTimeout(() => fired.push('c'), 15);
    cancel();
    clock.advance(9);
    expect(fired).toEqual([]);
    clock.advance(20);
    expect(fired).toEqual(['a', 'b']);
    expect(clock.now().getTime()).toBe(29);
  });

  it('runs timers scheduled by timers within the window', () => {
    const clock = new FakeClock(0);
    const fired: number[] = [];
    clock.setTimeout(() => {
      fired.push(clock.now().getTime());
      clock.setTimeout(() => fired.push(clock.now().getTime()), 5);
    }, 5);
    clock.advance(10);
    expect(fired).toEqual([5, 10]);
  });
});

describe('fakePlatform', () => {
  it('normalizes PATHEXT only on Windows', () => {
    expect(fakePlatform('win32', 'C:\\bin', ['.EXE', '.CMD']).pathExt).toEqual(['.exe', '.cmd']);
    expect(fakePlatform('linux', '/bin', ['.EXE']).pathExt).toEqual([]);
  });
});
