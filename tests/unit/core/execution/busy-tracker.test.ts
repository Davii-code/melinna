import { describe, expect, it } from 'vitest';
import { BUSY_QUIET_MS, BusyTracker } from '../../../../src/core/execution/busy-tracker';
import { FakeClock } from '../../../support/fakes/clock';

function setup() {
  const clock = new FakeClock();
  const changes: [string, boolean][] = [];
  const t = new BusyTracker(clock, (id, busy) => changes.push([id, busy]));
  return { clock, changes, t };
}

describe('BusyTracker', () => {
  it('is busy until 1.5 s after the last activity', () => {
    const { clock, changes, t } = setup();
    t.activity('e1');
    expect(t.isBusy('e1')).toBe(true);
    clock.advance(1000);
    t.activity('e1');
    clock.advance(BUSY_QUIET_MS - 1);
    expect(t.isBusy('e1')).toBe(true);
    clock.advance(1);
    expect(t.isBusy('e1')).toBe(false);
    expect(changes).toEqual([
      ['e1', true],
      ['e1', false],
    ]);
  });

  it('accounts for activity reported in the past', () => {
    const { clock, t } = setup();
    t.activity('e1', new Date(clock.now().getTime() - 1000));
    expect(t.isBusy('e1')).toBe(true);
    clock.advance(500);
    expect(t.isBusy('e1')).toBe(false);
    t.activity('e2', new Date(clock.now().getTime() - 5000));
    expect(t.isBusy('e2')).toBe(false);
  });

  it('an ended execution is never busy', () => {
    const { clock, changes, t } = setup();
    t.activity('e1');
    t.ended('e1');
    expect(t.isBusy('e1')).toBe(false);
    expect(t.busyIds()).toEqual([]);
    clock.advance(BUSY_QUIET_MS * 2);
    expect(changes).toEqual([
      ['e1', true],
      ['e1', false],
    ]);
    t.ended('nunca-ativa');
    expect(changes).toHaveLength(2);
  });

  it('whenIdle resolves once the execution goes quiet', async () => {
    const { clock, t } = setup();
    await expect(t.whenIdle('e1')).resolves.toBeUndefined();
    t.activity('e1');
    let done = false;
    const p = t.whenIdle('e1').then(() => {
      done = true;
    });
    clock.advance(1000);
    await Promise.resolve();
    expect(done).toBe(false);
    clock.advance(BUSY_QUIET_MS);
    await p;
    expect(done).toBe(true);
  });
});
