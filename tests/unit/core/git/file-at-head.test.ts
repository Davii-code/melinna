import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { FILE_AT_HEAD_MAX_BYTES, fileAtHead } from '../../../../src/core/git/file-at-head';
import { GitRunner } from '../../../../src/core/git/git-runner';
import type { RunResult } from '../../../../src/core/ports/process-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner, failed, ok } from '../../../support/fakes/process-runner';

/** Repositório em /repo, com a pasta do workspace em /repo/app (diferente da raiz). */
function setup(over: { top?: RunResult; size?: RunResult; blob?: RunResult } = {}) {
  const runner = new FakeProcessRunner();
  runner.on((_f, args) => {
    const sub = args[3];
    if (sub === 'rev-parse') return over.top ?? ok('/repo\n');
    if (sub === 'cat-file' && args[4] === '-s') return over.size ?? ok('12\n');
    if (sub === 'cat-file' && args[4] === 'blob') return over.blob ?? ok('linha um\nlinha dois\n');
    return undefined;
  });
  return { runner, deps: { git: new GitRunner(runner, new MemoryLogger()), os: 'linux' as const } };
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('fileAtHead', () => {
  it('returns the text of the file at HEAD', async () => {
    const { deps } = setup();
    expect(await fileAtHead(deps, '/repo/app', '/repo/app/src/a.ts')).toEqual({
      text: 'linha um\nlinha dois\n',
    });
  });

  it('asks git with the path relative to the repository root, with /, and read-only flags', async () => {
    const { deps, runner } = setup();
    await fileAtHead(deps, '/repo/app', '/repo/app/src/a.ts');
    const subs = runner.calls.map((c) => c.args.slice(3));
    expect(subs).toEqual([
      ['rev-parse', '--show-toplevel'],
      ['cat-file', '-s', 'HEAD:app/src/a.ts'],
      ['cat-file', 'blob', 'HEAD:app/src/a.ts'],
    ]);
    for (const call of runner.calls) expect(call.args).toContain('--no-optional-locks');
    expect(runner.calls[0]?.opts.cwd).toBe('/repo/app');
    expect(runner.calls[1]?.opts.cwd).toBe('/repo');
  });

  it('works with a Windows path and a toplevel with forward slashes', async () => {
    const runner = new FakeProcessRunner();
    runner.on((_f, args) => {
      if (args[3] === 'rev-parse') return ok('C:/ws/repo\n');
      if (args[4] === '-s') return ok('3\n');
      return ok('abc');
    });
    const deps = { git: new GitRunner(runner, new MemoryLogger()), os: 'win32' as const };
    expect(await fileAtHead(deps, 'C:\\ws\\repo', 'C:\\ws\\repo\\src\\A.ts')).toEqual({ text: 'abc' });
    expect(runner.calls[1]?.args.at(-1)).toBe('HEAD:src/A.ts');
  });

  it('refuses a path outside the folder with FILE_OUTSIDE_ROOT, without running git', async () => {
    const { deps, runner } = setup();
    for (const path of ['/repo/outra/a.ts', '/etc/passwd', 'relativo/a.ts', '/repo/app/../x.ts']) {
      expect((await failure(fileAtHead(deps, '/repo/app', path))).code, path).toBe('FILE_OUTSIDE_ROOT');
    }
    expect(runner.calls).toHaveLength(0);
  });

  it('is missing outside git', async () => {
    const { deps } = setup({ top: failed(128, 'fatal: not a git repository') });
    expect(await fileAtHead(deps, '/repo/app', '/repo/app/a.ts')).toEqual({ missing: true });
  });

  it('is missing for an untracked file or a repository without commits', async () => {
    const { deps } = setup({ size: failed(128, "fatal: path 'a.ts' exists on disk, but not in 'HEAD'") });
    expect(await fileAtHead(deps, '/repo/app', '/repo/app/a.ts')).toEqual({ missing: true });
  });

  it('is missing above 2 MB, without reading the content', async () => {
    const { deps, runner } = setup({ size: ok(`${FILE_AT_HEAD_MAX_BYTES + 1}\n`) });
    expect(await fileAtHead(deps, '/repo/app', '/repo/app/a.ts')).toEqual({ missing: true });
    expect(runner.calls.some((c) => c.args.includes('blob'))).toBe(false);
  });

  it('is missing for a binary file', async () => {
    const binary: RunResult = { exitCode: 0, stdout: new Uint8Array([1, 0, 2]), stderr: new Uint8Array() };
    const { deps } = setup({ blob: binary });
    expect(await fileAtHead(deps, '/repo/app', '/repo/app/a.png')).toEqual({ missing: true });
  });
});
