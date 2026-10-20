import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { toResult } from '../../../../src/main/ipc/result';
import { bool, existing, id, int, oneOf, str, termSize } from '../../../../src/main/ipc/validate-common';
import { MemoryLogger } from '../../../support/fakes/logger';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as MelinnaError).code;
  }
  return 'none';
};

describe('common validators', () => {
  it('check types and sizes', () => {
    expect(str('ab', 'x', 1, 2)).toBe('ab');
    expect(code(() => str('abc', 'x', 1, 2))).toBe('INPUT_INVALID');
    expect(code(() => str(1, 'x'))).toBe('INPUT_INVALID');
    expect(code(() => id('../etc'))).toBe('INPUT_INVALID');
    expect(id('a-1')).toBe('a-1');
    expect(code(() => int(1.5, 'n', 0, 9))).toBe('INPUT_INVALID');
    expect(code(() => int(10, 'n', 0, 9))).toBe('INPUT_INVALID');
    expect(code(() => bool('true', 'b'))).toBe('INPUT_INVALID');
    expect(oneOf('a', 'k', ['a', 'b'])).toBe('a');
    expect(code(() => oneOf('c', 'k', ['a', 'b']))).toBe('INPUT_INVALID');
    expect(termSize({ cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 });
    expect(code(() => termSize({ cols: 19, rows: 24 }))).toBe('INPUT_INVALID');
    expect(code(() => termSize({ cols: 80, rows: 501 }))).toBe('INPUT_INVALID');
    expect(code(() => existing('x', 'Grupo', () => false))).toBe('INPUT_INVALID');
  });

  it('maps MelinnaError and unknown errors to Result without rejecting', async () => {
    const log = new MemoryLogger();
    expect(await toResult(log, 'c', () => 5)).toEqual({ ok: true, value: 5 });
    expect(await toResult(log, 'c', () => Promise.reject(new MelinnaError('REPO_INVALID')))).toMatchObject({
      ok: false,
      error: { code: 'REPO_INVALID' },
    });
    const internal = await toResult(log, 'c', () => {
      throw new TypeError('detalhe interno');
    });
    expect(internal).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    expect(JSON.stringify(internal)).not.toContain('detalhe interno');
    expect(log.events()).toEqual(['ipc.internal_error']);
    const withDetails = await toResult(log, 'c', () =>
      Promise.reject(new MelinnaError('WORKTREE_RESIDUE', { details: { residuePath: '/p' } })),
    );
    expect(withDetails).toMatchObject({ ok: false, error: { details: { residuePath: '/p' } } });
  });
});
