import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  MelinnaError,
  defaultUserMessage,
  isMelinnaError,
  toIpcError,
} from '../../../src/core/errors';
import { newId } from '../../../src/core/ids';

describe('MelinnaError', () => {
  it('has a pt-BR default message for every code', () => {
    for (const code of ERROR_CODES) {
      expect(defaultUserMessage(code).length).toBeGreaterThan(5);
    }
    expect(ERROR_CODES).toContain('HOST_AUTH');
    expect(ERROR_CODES).toContain('HOST_VERSION');
    expect(ERROR_CODES).toContain('INPUT_INVALID');
    expect(ERROR_CODES).toContain('WORK_WOULD_BE_LOST');
    expect(ERROR_CODES).toContain('INTERNAL');
  });

  it('keeps code, user message, details and cause', () => {
    const cause = new Error('raiz');
    const err = new MelinnaError('GIT_FAILED', {
      userMessage: 'git quebrou',
      details: { exitCode: 128 },
      cause,
    });
    expect(err.code).toBe('GIT_FAILED');
    expect(err.userMessage).toBe('git quebrou');
    expect(err.message).toBe('git quebrou');
    expect(err.details).toEqual({ exitCode: 128 });
    expect(err.cause).toBe(cause);
    expect(isMelinnaError(err)).toBe(true);
    expect(isMelinnaError(new Error('x'))).toBe(false);
  });

  it('uses the default message when none is given', () => {
    expect(new MelinnaError('LIMIT_REACHED').userMessage).toBe(defaultUserMessage('LIMIT_REACHED'));
  });

  it('maps errors to IPC errors, unknown ones to INTERNAL', () => {
    expect(toIpcError(new MelinnaError('REPO_INVALID'))).toEqual({
      code: 'REPO_INVALID',
      message: defaultUserMessage('REPO_INVALID'),
    });
    expect(
      toIpcError(new MelinnaError('WORKTREE_RESIDUE', { details: { residuePath: '/x' } })).details,
    ).toEqual({
      residuePath: '/x',
    });
    const internal = toIpcError(new TypeError('segredo interno'));
    expect(internal.code).toBe('INTERNAL');
    expect(internal.message).not.toContain('segredo');
    expect(toIpcError('texto').code).toBe('INTERNAL');
  });
});

describe('newId', () => {
  it('returns unique uuids', () => {
    const a = newId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(a);
  });
});
