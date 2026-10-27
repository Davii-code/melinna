import { describe, expect, it } from 'vitest';
import { defaultUserMessage } from '../../../../src/core/errors';
import { classifyGitFailure, maskCredentials, pickErrorLine } from '../../../../src/core/git/git-errors';

const ctx = { command: 'push', exitCode: 1 };

describe('pickErrorLine', () => {
  it('picks the fatal/error line and ignores warnings', () => {
    const stderr = [
      "warning: in the working copy of 'a.txt', LF will be replaced by CRLF the next time Git touches it",
      'fatal: pathspec foi mal formado',
      'hint: veja a ajuda',
    ].join('\n');
    expect(pickErrorLine(stderr)).toBe('fatal: pathspec foi mal formado');
  });

  it('falls back to the first non-warning line and then to null', () => {
    expect(pickErrorLine('warning: LF will be replaced\nalgo deu errado\n')).toBe('algo deu errado');
    expect(pickErrorLine('warning: LF will be replaced\n')).toBeNull();
    expect(pickErrorLine('')).toBeNull();
  });
});

describe('maskCredentials', () => {
  it('masks user and token in URLs', () => {
    expect(maskCredentials('fatal: unable to access https://user:token@github.com/x/y.git/')).toBe(
      'fatal: unable to access https://***@github.com/x/y.git/',
    );
    expect(maskCredentials('remote: https://ghp_abc123@host.com/r')).toBe('remote: https://***@host.com/r');
  });

  it('leaves URLs without credentials alone', () => {
    expect(maskCredentials('https://github.com/x/y.git')).toBe('https://github.com/x/y.git');
  });
});

describe('classifyGitFailure', () => {
  it('maps authentication failures to GIT_AUTH', () => {
    for (const stderr of [
      "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/x/y.git/'",
      'fatal: could not read Username for https://github.com: terminal prompts disabled',
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    ]) {
      const e = classifyGitFailure(stderr, ctx);
      expect(e.code).toBe('GIT_AUTH');
      expect(e.userMessage).toBe(defaultUserMessage('GIT_AUTH'));
    }
  });

  it('maps rejected pushes to GIT_REJECTED', () => {
    const stderr = [
      'To ../remote.git',
      ' ! [rejected]        main -> main (fetch first)',
      "error: failed to push some refs to '../remote.git'",
    ].join('\n');
    expect(classifyGitFailure(stderr, ctx).code).toBe('GIT_REJECTED');
    expect(
      classifyGitFailure('hint: Updates were rejected because the tip is behind (fetch first)', ctx).code,
    ).toBe('GIT_REJECTED');
  });

  it('maps a missing identity to GIT_IDENTITY', () => {
    const stderr = '*** Please tell me who you are.\n\nRun\n\n  git config user.email "you@example.com"\n';
    expect(classifyGitFailure(stderr, { command: 'commit', exitCode: 128 }).code).toBe('GIT_IDENTITY');
    expect(
      classifyGitFailure('fatal: unable to auto-detect email address', { command: 'commit', exitCode: 128 })
        .code,
    ).toBe('GIT_IDENTITY');
    expect(
      classifyGitFailure('fatal: no email was given and auto-detection is disabled', {
        command: 'commit',
        exitCode: 128,
      }).code,
    ).toBe('GIT_IDENTITY');
  });

  it('maps a failing commit hook to GIT_HOOK_FAILED and keeps its output in the message', () => {
    const e = classifyGitFailure('lint falhou: 3 erros\n', {
      command: 'commit',
      exitCode: 1,
      canRunHooks: true,
    });
    expect(e.code).toBe('GIT_HOOK_FAILED');
    expect(e.userMessage).toContain(defaultUserMessage('GIT_HOOK_FAILED'));
    expect(e.userMessage).toContain('lint falhou: 3 erros');
  });

  it('maps hook rejection by name to GIT_HOOK_FAILED', () => {
    const stderr =
      ' ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs';
    expect(classifyGitFailure(stderr, ctx).code).toBe('GIT_HOOK_FAILED');
  });

  it('maps index.lock to GIT_LOCKED', () => {
    const stderr =
      "fatal: Unable to create '/r/.git/index.lock': File exists.\n\nAnother git process seems to be running";
    const e = classifyGitFailure(stderr, { command: 'add', exitCode: 128 });
    expect(e.code).toBe('GIT_LOCKED');
    expect(e.userMessage).toBe(defaultUserMessage('GIT_LOCKED'));
  });

  it('maps everything else to GIT_FAILED with the error line, masked', () => {
    const stderr = [
      "warning: in the working copy of 'a.txt', LF will be replaced by CRLF the next time Git touches it",
      'fatal: unable to access https://user:token@host.com/r.git/: Could not resolve host: host.com',
    ].join('\n');
    const e = classifyGitFailure(stderr, { command: 'fetch', exitCode: 128 });
    expect(e.code).toBe('GIT_FAILED');
    expect(e.userMessage).toBe(
      'fatal: unable to access https://***@host.com/r.git/: Could not resolve host: host.com',
    );
    expect(e.userMessage).not.toContain('token');
    expect(e.details.command).toBe('fetch');
    expect(e.details.exitCode).toBe(128);
  });

  it('maps an empty commit to INPUT_INVALID instead of a hook failure', () => {
    const e = classifyGitFailure('On branch main\nnothing to commit, working tree clean\n', {
      command: 'commit',
      exitCode: 1,
      canRunHooks: true,
    });
    expect(e.code).toBe('INPUT_INVALID');
    expect(e.userMessage).toBe('Não há alterações para commitar.');
  });

  it('falls back to the exit code when stderr says nothing', () => {
    const e = classifyGitFailure('', { command: 'merge', exitCode: 3 });
    expect(e.code).toBe('GIT_FAILED');
    expect(e.userMessage).toContain('3');
  });

  it('never leaks credentials into details', () => {
    const e = classifyGitFailure('fatal: x https://u:p@h.com/r', { command: 'push', exitCode: 128 });
    expect(JSON.stringify(e.details)).not.toContain('u:p');
  });
});
