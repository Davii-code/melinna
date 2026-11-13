import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { parsePrOutput, PR_TIMEOUT_MS, PullRequestService } from '../../../../src/core/git/pull-request';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { fakePlatform } from '../../../support/fakes/platform';
import { failed, FakeProcessRunner, ok } from '../../../support/fakes/process-runner';

const URL = 'https://github.com/acme/app/pull/12';
const linux = fakePlatform('linux', '/usr/bin');
const win = fakePlatform('win32', 'C:\\tools', ['.EXE', '.CMD']);

function setup(platform = linux, ghPath: string | null = '/usr/bin/gh') {
  const fs = new MemoryFileSystem();
  if (ghPath) fs.seed(ghPath, 'bin');
  const runner = new FakeProcessRunner();
  const log = new MemoryLogger();
  const service = new PullRequestService({ runner, fs, platform, log });
  return { service, runner, log };
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('deveria ter falhado');
}

describe('parsePrOutput', () => {
  it('reads the link of the created pull request', () => {
    expect(parsePrOutput(0, `\nCreating pull request for nova into main\n\n${URL}\n`, '')).toEqual({
      kind: 'created',
      url: URL,
    });
  });

  it('returns the link of a pull request that already exists', () => {
    const stderr = `a pull request for branch "nova" into branch "main" already exists:\n${URL}\n`;
    expect(parsePrOutput(1, '', stderr)).toEqual({ kind: 'existing', url: URL });
  });

  it('classifies the usual failures', () => {
    const reason = (stderr: string) => {
      const r = parsePrOutput(1, '', stderr);
      return r.kind === 'failed' ? r.reason : r.kind;
    };
    expect(reason('aborted: you must first push the current branch to a remote, or use the --head flag')).toBe(
      'not-pushed',
    );
    expect(reason('To get started with GitHub CLI, please run:  gh auth login')).toBe('auth');
    expect(reason('pull request create failed: GraphQL: No commits between main and nova')).toBe('no-commits');
    expect(reason('algo inesperado')).toBe('other');
  });

  it('fails when a successful run prints no link', () => {
    expect(parsePrOutput(0, 'pronto', '')).toEqual({ kind: 'failed', reason: 'other', detail: 'pronto' });
  });
});

describe('PullRequestService', () => {
  it('creates the pull request from the commits, without prompts, inside the repository', async () => {
    const { service, runner } = setup();
    runner.when('/usr/bin/gh', ['pr', 'create', '--fill'], ok(`${URL}\n`));
    expect(await service.create('/repo')).toEqual({ url: URL, existing: false });
    const call = runner.calls[0]!;
    expect(call.args).toEqual(['pr', 'create', '--fill']);
    expect(call.opts.cwd).toBe('/repo');
    expect(call.opts.timeoutMs).toBe(PR_TIMEOUT_MS);
    expect(call.opts.env).toMatchObject({ GH_PROMPT_DISABLED: '1' });
  });

  it('returns the existing pull request instead of failing', async () => {
    const { service, runner } = setup();
    runner.on(() => failed(1, `a pull request for branch "x" into branch "main" already exists:\n${URL}`));
    expect(await service.create('/repo')).toEqual({ url: URL, existing: true });
  });

  it('explains how to install gh when it is missing and runs nothing', async () => {
    const { service, runner } = setup(linux, null);
    const err = await failure(service.create('/repo'));
    expect(err.code).toBe('PROGRAM_NOT_FOUND');
    expect(err.userMessage).toContain('https://cli.github.com');
    expect(runner.calls).toEqual([]);
  });

  it('refuses a batch launcher on Windows', async () => {
    const { service, runner } = setup(win, 'C:\\tools\\gh.cmd');
    expect((await failure(service.create('C:\\repo'))).code).toBe('PROGRAM_NOT_FOUND');
    expect(runner.calls).toEqual([]);
  });

  it('turns known failures into guidance', async () => {
    const { service, runner } = setup();
    runner.on(() => failed(1, 'aborted: you must first push the current branch to a remote, or use the --head flag'));
    const err = await failure(service.create('/repo'));
    expect(err.code).toBe('GIT_FAILED');
    expect(err.userMessage).toBe('Faça push da branch antes de criar o pull request.');
  });

  it('shows the output of an unknown failure', async () => {
    const { service, runner } = setup();
    runner.on(() => failed(1, 'could not determine base repository'));
    expect((await failure(service.create('/repo'))).userMessage).toBe(
      'O gh pr create falhou: could not determine base repository',
    );
  });

  it('fails with GIT_FAILED when gh cannot be started', async () => {
    const { service } = setup();
    const err = await failure(service.create('/repo'));
    expect(err.code).toBe('GIT_FAILED');
    expect(err.userMessage).toBe('Não foi possível executar o GitHub CLI (gh).');
  });
});
