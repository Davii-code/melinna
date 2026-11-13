import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { MESSAGE_DIFF_LIMIT } from '../../../../src/core/git/git-service';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let repo: TempRepo;
let rig: GitServiceRig;

beforeEach(() => {
  repo = createTempRepo({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
  repo.commit({ 'c.txt': 'c\n' }, 'Add c');
  rig = makeGitService();
});

afterEach(() => {
  repo.cleanup();
  rig.cleanup();
});

function write(rel: string, content: string): void {
  writeFileSync(join(repo.root, rel), content);
}

describe('GitService.messageContext', () => {
  it('returns the diff of the chosen files only, tracked and untracked', async () => {
    write('a.txt', 'a mudou\n');
    write('b.txt', 'b mudou\n');
    write('novo.txt', 'conteúdo novo\n');
    const ctx = await rig.service.messageContext(repo.root, ['a.txt', 'novo.txt']);
    expect(ctx.truncated).toBe(false);
    expect(ctx.diff).toContain('+a mudou');
    expect(ctx.diff).toContain('+conteúdo novo');
    expect(ctx.diff).not.toContain('b mudou');
  });

  it('lists the subjects of the recent commits, newest first', async () => {
    write('a.txt', 'x\n');
    const ctx = await rig.service.messageContext(repo.root, ['a.txt']);
    expect(ctx.recent).toEqual(['Add c', 'inicial']);
  });

  it('includes staged changes and does not touch the index', async () => {
    write('a.txt', 'no índice\n');
    git(repo.root, ['add', 'a.txt']);
    const before = git(repo.root, ['status', '--porcelain']);
    const ctx = await rig.service.messageContext(repo.root, ['a.txt']);
    expect(ctx.diff).toContain('+no índice');
    expect(git(repo.root, ['status', '--porcelain'])).toBe(before);
  });

  it('cuts a diff above the limit and says so', async () => {
    write('a.txt', `${'linha comprida de texto\n'.repeat(Math.ceil(MESSAGE_DIFF_LIMIT / 20))}`);
    const ctx = await rig.service.messageContext(repo.root, ['a.txt']);
    expect(ctx.truncated).toBe(true);
    expect(ctx.diff).toHaveLength(MESSAGE_DIFF_LIMIT);
  });

  it('refuses files without changes and unsafe paths', async () => {
    write('a.txt', 'x\n');
    const noChange = await rig.service.messageContext(repo.root, ['b.txt']).catch((e: unknown) => e);
    expect((noChange as MelinnaError).code).toBe('INPUT_INVALID');
    const unsafe = await rig.service.messageContext(repo.root, ['../fora.txt']).catch((e: unknown) => e);
    expect((unsafe as MelinnaError).code).toBe('INPUT_INVALID');
  });
});
