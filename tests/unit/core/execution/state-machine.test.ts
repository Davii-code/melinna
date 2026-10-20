import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import {
  canTransition,
  isLive,
  transition,
  type ExecutionEvent,
} from '../../../../src/core/execution/state-machine';
import type { ExecutionStatus } from '../../../../src/core/persistence/state-schema';

const ALL: ExecutionStatus[] = [
  'preparing',
  'starting',
  'running',
  'idle',
  'exited',
  'failed_to_start',
  'lost',
];
const EVENTS: ExecutionEvent[] = [
  'prepared',
  'spawned',
  'output',
  'quiet',
  'exit',
  'fail',
  'lost',
  'relaunch',
  'remove',
];

describe('execution state machine', () => {
  it('follows the data-model graph', () => {
    expect(transition('preparing', 'prepared')).toBe('starting');
    expect(transition('starting', 'spawned')).toBe('running');
    expect(transition('running', 'quiet')).toBe('idle');
    expect(transition('idle', 'output')).toBe('running');
    expect(transition('running', 'exit')).toBe('exited');
    expect(transition('idle', 'exit')).toBe('exited');
    expect(transition('preparing', 'fail')).toBe('failed_to_start');
    expect(transition('starting', 'fail')).toBe('failed_to_start');
    expect(transition('running', 'lost')).toBe('lost');
    expect(transition('idle', 'lost')).toBe('lost');
    for (const s of ['exited', 'failed_to_start', 'lost'] as const) {
      expect(transition(s, 'relaunch')).toBe('starting');
      expect(canTransition(s, 'remove')).toBe(true);
    }
  });

  it('rejects invalid transitions with typed errors', () => {
    const expectCode = (s: ExecutionStatus, e: ExecutionEvent, code: string) => {
      try {
        transition(s, e);
        expect.unreachable(`${s} + ${e}`);
      } catch (err) {
        expect(err).toBeInstanceOf(MelinnaError);
        expect((err as MelinnaError).code).toBe(code);
      }
    };
    expectCode('running', 'relaunch', 'EXECUTION_RUNNING');
    expectCode('running', 'remove', 'EXECUTION_RUNNING');
    expectCode('preparing', 'remove', 'EXECUTION_RUNNING');
    expectCode('exited', 'exit', 'EXECUTION_NOT_RUNNING');
    expectCode('exited', 'spawned', 'EXECUTION_NOT_RUNNING');
    expectCode('lost', 'output', 'EXECUTION_NOT_RUNNING');
  });

  it('every pair either transitions or throws', () => {
    for (const s of ALL)
      for (const e of EVENTS) if (!canTransition(s, e)) expect(() => transition(s, e)).toThrow(MelinnaError);
  });

  it('classifies live states', () => {
    expect(ALL.filter(isLive)).toEqual(['preparing', 'starting', 'running', 'idle']);
  });
});
