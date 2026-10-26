import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let repo: TempRepo;
let rig: GitServiceRig;

beforeEach(() => {
  repo = createTempRepo({
    files: {
      'app/src/a.ts': 'linha um\r\nlinha dois\r\n',
      'app/logo.bin': new Uint8Array([1, 0, 2, 3]),
    },
  });
  rig = makeGitService();
});

afterEach(() => {
  repo.cleanup();
  rig.cleanup();
});

describe('GitService.fileAtHead (git real)', () => {
  it('reads the committed text even after the file changed on disk', async () => {
    writeFileSync(join(repo.root, 'app', 'src', 'a.ts'), 'mudou\n');
    const r = await rig.service.fileAtHead(repo.root, join(repo.root, 'app', 'src', 'a.ts'));
    expect(r).toEqual({ text: expect.stringContaining('linha um') });
  });

  it('uses the repository root when the workspace folder is a subfolder of it', async () => {
    const folder = join(repo.root, 'app');
    const r = await rig.service.fileAtHead(folder, join(folder, 'src', 'a.ts'));
    expect(r).toMatchObject({ text: expect.stringContaining('linha dois') });
  });

  it('follows the new HEAD after a commit', async () => {
    repo.commit({ 'app/src/a.ts': 'versao nova\n' }, 'muda a');
    const r = await rig.service.fileAtHead(repo.root, join(repo.root, 'app', 'src', 'a.ts'));
    expect(r).toEqual({ text: 'versao nova\n' });
  });

  it('is missing for an untracked file and for a binary one', async () => {
    mkdirSync(join(repo.root, 'novo'), { recursive: true });
    writeFileSync(join(repo.root, 'novo', 'x.ts'), 'x');
    expect(await rig.service.fileAtHead(repo.root, join(repo.root, 'novo', 'x.ts'))).toEqual({
      missing: true,
    });
    expect(await rig.service.fileAtHead(repo.root, join(repo.root, 'app', 'logo.bin'))).toEqual({
      missing: true,
    });
  });

  it('refuses a path outside the folder', async () => {
    const err = (await rig.service
      .fileAtHead(join(repo.root, 'app'), join(repo.root, 'README.md'))
      .catch((e: unknown) => e)) as MelinnaError;
    expect(err.code).toBe('FILE_OUTSIDE_ROOT');
  });

  it('does not touch the index (read-only)', async () => {
    const before = git(repo.root, ['status', '--porcelain']);
    await rig.service.fileAtHead(repo.root, join(repo.root, 'app', 'src', 'a.ts'));
    expect(git(repo.root, ['status', '--porcelain'])).toBe(before);
  });
});
