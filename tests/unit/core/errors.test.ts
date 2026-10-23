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
    expect(ERROR_CODES).toContain('IO_ERROR');
    expect(ERROR_CODES).toContain('INTERNAL');
  });

  it('has the git codes with the contract messages', () => {
    for (const code of [
      'GIT_AUTH',
      'GIT_REJECTED',
      'GIT_IDENTITY',
      'GIT_HOOK_FAILED',
      'GIT_LOCKED',
      'GIT_FAILED',
    ] as const) {
      expect(ERROR_CODES).toContain(code);
    }
    expect(defaultUserMessage('GIT_AUTH')).toBe(
      'O git não conseguiu se autenticar no remoto. Configure suas credenciais (Git Credential Manager ou SSH) e tente de novo.',
    );
    expect(defaultUserMessage('GIT_REJECTED')).toBe(
      'O remoto recusou o envio porque tem commits novos. Faça pull antes.',
    );
    expect(defaultUserMessage('GIT_IDENTITY')).toBe(
      'Configure seu nome e e-mail no git (git config user.name / user.email).',
    );
    expect(defaultUserMessage('GIT_HOOK_FAILED')).toBe('Um hook do git recusou a operação.');
    expect(defaultUserMessage('GIT_LOCKED')).toBe(
      'Outro processo do git está usando este repositório — talvez um agente. Tente de novo em instantes.',
    );
  });

  it('has the run codes with the contract messages', () => {
    for (const code of ['PROGRAM_NOT_FOUND', 'COMMAND_STALE'] as const) {
      expect(ERROR_CODES).toContain(code);
    }
    expect(defaultUserMessage('COMMAND_STALE')).toBe('A configuração mudou; abra o seletor de novo.');
    expect(defaultUserMessage('PROGRAM_NOT_FOUND')).toMatch(/^Programa não encontrado/);
    expect(ERROR_CODES as readonly string[]).not.toContain('IDE_NOT_FOUND');
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
