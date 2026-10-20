import { describe, expect, it } from 'vitest';
import { IdleExit } from '../../../src/host/idle-exit';
import { FakeClock } from '../../support/fakes/clock';

describe('IdleExit', () => {
  function setup() {
    const clock = new FakeClock(0);
    const state = { alive: 0, connections: 0 };
    let exited = 0;
    const idle = new IdleExit(
      clock,
      () => state,
      () => exited++,
    );
    return { clock, state, idle, exited: () => exited };
  }

  it('exits after 60 s without processes and connections', () => {
    const { clock, idle, exited } = setup();
    idle.evaluate();
    clock.advance(59_999);
    expect(exited()).toBe(0);
    clock.advance(1);
    expect(exited()).toBe(1);
  });

  it('a connection or a spawn restarts the countdown', () => {
    const { clock, state, idle, exited } = setup();
    idle.evaluate();
    clock.advance(30_000);
    state.connections = 1;
    idle.evaluate();
    clock.advance(60_000);
    expect(exited()).toBe(0);
    state.connections = 0;
    idle.evaluate();
    clock.advance(40_000);
    idle.touch();
    clock.advance(40_000);
    expect(exited()).toBe(0);
    clock.advance(20_000);
    expect(exited()).toBe(1);
  });

  it('never exits with a live process', () => {
    const { clock, state, idle, exited } = setup();
    state.alive = 1;
    idle.evaluate();
    clock.advance(10 * 60_000);
    expect(exited()).toBe(0);
    state.alive = 0;
    idle.evaluate();
    clock.advance(60_000);
    expect(exited()).toBe(1);
  });
});
