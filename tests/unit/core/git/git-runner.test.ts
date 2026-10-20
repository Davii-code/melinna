import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner, failed, ok } from '../../../support/fakes/process-runner';

describe('GitRunner', () => {
  it('prefixes core.quotepath=off and --no-optional-locks for reads', async () => {
    const runner = new FakeProcessRunner().when('git', [], ok('x\n'));
    const git = new GitRunner(runner, new MemoryLogger());
    await git.run(['status', '--porcelain=v1'], { cwd: '/r', read: true });
    await git.run(['worktree', 'add'], { cwd: '/r' });
    expect(runner.calls[0]?.args).toEqual([
      '-c',
      'core.quotepath=off',
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
    ]);
    expect(runner.calls[1]?.args).toEqual(['-c', 'core.quotepath=off', 'worktree', 'add']);
    expect(runner.calls[0]?.opts.cwd).toBe('/r');
    expect(runner.calls[0]?.opts.env?.GIT_TERMINAL_PROMPT).toBe('0');
  });

  it('throws GIT_FAILED with stderr truncated to 2 KB and logs without user args', async () => {
    const long = 'e'.repeat(5000);
    const runner = new FakeProcessRunner().when('git', [], failed(128, long));
    const log = new MemoryLogger();
    const git = new GitRunner(runner, log);
    try {
      await git.run(['checkout', 'branch-secreta-do-usuario'], { cwd: '/r' });
      expect.unreachable();
    } catch (err) {
      const e = err as MelinnaError;
      expect(e.code).toBe('GIT_FAILED');
      expect(String(e.details.stderr).length).toBeLessThanOrEqual(2049);
      expect(e.details.exitCode).toBe(128);
    }
    expect(log.events()).toEqual(['git.failed']);
    expect(log.text()).not.toContain('branch-secreta-do-usuario');
    expect(log.records[0]?.fields.command).toBe('checkout');
  });

  it('allows failure when asked', async () => {
    const git = new GitRunner(new FakeProcessRunner().when('git', [], failed(1, 'no')), new MemoryLogger());
    const r = await git.run(['rev-parse', '--verify', 'x'], { cwd: '/r', allowFail: true });
    expect(r.exitCode).toBe(1);
  });

  it('maps a missing git binary to GIT_FAILED', async () => {
    const git = new GitRunner(new FakeProcessRunner(), new MemoryLogger());
    await expect(git.run(['status'], { cwd: '/r' })).rejects.toMatchObject({ code: 'GIT_FAILED' });
  });
});
