import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';
import { removeDirRecursive } from '../../../support/temp-dirs';

let repo: TempRepo;
let rig: GitServiceRig;

beforeEach(() => {
  repo = createTempRepo({ files: { 'base.txt': 'base\n' } });
  rig = makeGitService();
});

afterEach(() => {
  repo.cleanup();
  rig.cleanup();
});

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

/** Cria `count` commits de uma vez com `git fast-import` (uma chamada em vez de centenas). */
function manyCommits(count: number): void {
  const parts: string[] = [];
  for (let i = 1; i <= count; i++) {
    const msg = `commit ${i}`;
    parts.push(
      'commit refs/heads/main',
      `committer Teste <teste@example.com> ${1_700_000_000 + i} +0000`,
      `data ${msg.length}`,
      msg,
      ...(i === 1 ? ['from refs/heads/main^0'] : []),
      'M 100644 inline contador.txt',
      `data ${String(i).length + 1}`,
      String(i),
      '',
    );
  }
  git(repo.root, ['fast-import', '--quiet'], `${parts.join('\n')}\n`);
  git(repo.root, ['reset', '-q', '--hard', 'main']);
}

describe('GitService.log', () => {
  it('returns pages of 200 commits, newest first, using skip', async () => {
    manyCommits(205);
    const first = await rig.service.log(repo.root, 0);
    expect(first).toHaveLength(200);
    expect(first[0]?.subject).toBe('commit 205');
    expect(first[199]?.subject).toBe('commit 6');
    const second = await rig.service.log(repo.root, 200);
    expect(second.map((c) => c.subject)).toEqual(['commit 5', 'commit 4', 'commit 3', 'commit 2', 'commit 1', 'inicial']);
    expect(await rig.service.log(repo.root, 206)).toEqual([]);
  }, 60_000);

  it('describes each commit with author, date, body and files', async () => {
    writeFileSync(join(repo.root, 'novo.txt'), 'novo\n');
    git(repo.root, ['mv', 'base.txt', 'renomeado.txt']);
    git(repo.root, ['add', '-A']);
    git(repo.root, ['commit', '-q', '-m', 'Título com ação', '-m', 'Corpo da mensagem\nsegunda linha']);
    const [head, initial] = await rig.service.log(repo.root, 0);
    expect(head).toMatchObject({
      sha: repo.head(),
      shortSha: repo.head().slice(0, 7),
      author: 'Teste',
      email: 'teste@example.com',
      subject: 'Título com ação',
      body: 'Corpo da mensagem\nsegunda linha',
    });
    expect(head?.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(head?.files).toEqual(
      expect.arrayContaining([
        { path: 'novo.txt', kind: 'added' },
        { path: 'renomeado.txt', oldPath: 'base.txt', kind: 'renamed' },
      ]),
    );
    expect(initial?.subject).toBe('inicial');
    expect(initial?.files).toEqual(expect.arrayContaining([{ path: 'base.txt', kind: 'added' }]));
  });

  it('returns an empty list for a repository without commits', async () => {
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-vazio-')));
    try {
      git(dir, ['init', '-q', '-b', 'main']);
      expect(await rig.service.log(dir, 0)).toEqual([]);
      const status = await rig.service.status(dir);
      expect(status).toMatchObject({ head: '', branch: 'main', hasRemote: false });
    } finally {
      removeDirRecursive(dir);
    }
  });

  it('rejects a negative or fractional skip', async () => {
    expect((await failure(rig.service.log(repo.root, -1))).code).toBe('INPUT_INVALID');
    expect((await failure(rig.service.log(repo.root, 1.5))).code).toBe('INPUT_INVALID');
  });
});

describe('GitService.commitDiff', () => {
  function threeCommits(): string[] {
    const shas: string[] = [];
    for (const n of [1, 2, 3]) {
      writeFileSync(join(repo.root, `f${n}.txt`), `conteúdo ${n}\nlinha dois\n`);
      git(repo.root, ['add', '-A']);
      git(repo.root, ['commit', '-q', '-m', `c${n}`]);
      shas.push(git(repo.root, ['rev-parse', 'HEAD']).trim());
    }
    return shas;
  }

  it('returns the diff of one file of a commit', async () => {
    const [, second] = threeCommits();
    const diff = await rig.service.commitDiff(repo.root, second!, 'f2.txt');
    expect(diff).toMatchObject({ path: 'f2.txt', change: 'added' });
    expect(diff.hunks[0]?.lines.map((l) => l.text)).toEqual(['conteúdo 2', 'linha dois']);
  });

  it('shows a modification against the parent', async () => {
    writeFileSync(join(repo.root, 'base.txt'), 'base mudada\n');
    git(repo.root, ['commit', '-qam', 'muda']);
    const diff = await rig.service.commitDiff(repo.root, repo.head(), 'base.txt');
    expect(diff.change).toBe('modified');
    expect(diff.hunks[0]?.lines.map((l) => [l.kind, l.text])).toEqual([
      ['del', 'base'],
      ['add', 'base mudada'],
    ]);
  });

  it('follows a rename and describes binary files with their sizes', async () => {
    writeFileSync(join(repo.root, 'longo.txt'), 'conteúdo longo o bastante\nlinha 2\nlinha 3\nlinha 4\n');
    writeFileSync(join(repo.root, 'img.bin'), Buffer.from([0, 1, 2, 3, 0, 0]));
    git(repo.root, ['add', '-A']);
    git(repo.root, ['commit', '-q', '-m', 'prepara']);
    git(repo.root, ['mv', 'longo.txt', 'novo-nome.txt']);
    writeFileSync(join(repo.root, 'img.bin'), Buffer.from([0, 9, 9, 9, 9, 0, 0, 7]));
    git(repo.root, ['add', '-A']);
    git(repo.root, ['commit', '-q', '-m', 'renomeia']);
    const sha = repo.head();
    const renamed = await rig.service.commitDiff(repo.root, sha, 'novo-nome.txt');
    expect(renamed).toMatchObject({ path: 'novo-nome.txt', oldPath: 'longo.txt', change: 'renamed' });
    const binary = await rig.service.commitDiff(repo.root, sha, 'img.bin');
    expect(binary.binary).toEqual({ oldSize: 6, newSize: 8 });
  });

  it('works for the root commit', async () => {
    const root = git(repo.root, ['rev-list', '--max-parents=0', 'HEAD']).trim();
    const diff = await rig.service.commitDiff(repo.root, root, 'base.txt');
    expect(diff).toMatchObject({ path: 'base.txt', change: 'added' });
  });

  it('rejects invalid shas and paths', async () => {
    for (const sha of ['abc', '--output=x', 'ZZZZZZZ', 'a'.repeat(65)]) {
      expect((await failure(rig.service.commitDiff(repo.root, sha, 'base.txt'))).code).toBe('INPUT_INVALID');
    }
    expect((await failure(rig.service.commitDiff(repo.root, repo.head(), '../x'))).code).toBe('INPUT_INVALID');
  });
});
