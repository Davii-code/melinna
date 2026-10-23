import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let repo: TempRepo;
let rig: GitServiceRig;

beforeEach(() => {
  repo = createTempRepo({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' } });
  rig = makeGitService();
});

afterEach(() => {
  repo.cleanup();
  rig.cleanup();
});

function write(rel: string, content: string): void {
  const abs = join(repo.root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function committedFiles(rev = 'HEAD'): string[] {
  return git(repo.root, ['show', '--format=', '--name-status', '-M', rev])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('GitService.commit', () => {
  it('commits only the selected files and leaves the rest changed', async () => {
    write('a.txt', 'a2\n');
    write('b.txt', 'b2\n');
    write('c.txt', 'c2\n');
    const r = await rig.service.commit(repo.root, { paths: ['a.txt', 'b.txt'], message: 'dois de três', amend: false });
    expect(r).toEqual({ sha: repo.head() });
    expect(committedFiles()).toEqual(['M\ta.txt', 'M\tb.txt']);
    const status = await rig.service.status(repo.root);
    expect(status.changes.map((c) => c.path)).toEqual(['c.txt']);
  });

  it('keeps unrelated staged files staged and out of the commit', async () => {
    write('a.txt', 'a2\n');
    write('c.txt', 'c2\n');
    git(repo.root, ['add', 'c.txt']);
    await rig.service.commit(repo.root, { paths: ['a.txt'], message: 'só a', amend: false });
    expect(committedFiles()).toEqual(['M\ta.txt']);
    expect(git(repo.root, ['diff', '--cached', '--name-only']).trim()).toBe('c.txt');
  });

  it('includes the old path of a staged rename', async () => {
    git(repo.root, ['mv', 'a.txt', 'renomeado.txt']);
    const status = await rig.service.status(repo.root);
    expect(status.changes).toMatchObject([{ path: 'renomeado.txt', oldPath: 'a.txt', kind: 'renamed' }]);
    await rig.service.commit(repo.root, { paths: ['renomeado.txt'], message: 'renomeia', amend: false });
    expect(committedFiles()).toEqual(['R100\ta.txt\trenomeado.txt']);
    expect(git(repo.root, ['status', '--porcelain']).trim()).toBe('');
  });

  it('commits a new file inside a new folder', async () => {
    write('pasta/nova/arquivo.txt', 'oi\n');
    await rig.service.commit(repo.root, { paths: ['pasta/nova/arquivo.txt'], message: 'novo', amend: false });
    expect(committedFiles()).toEqual(['A\tpasta/nova/arquivo.txt']);
  });

  it('commits a deleted file', async () => {
    rmSync(join(repo.root, 'b.txt'));
    await rig.service.commit(repo.root, { paths: ['b.txt'], message: 'remove b', amend: false });
    expect(committedFiles()).toEqual(['D\tb.txt']);
  });

  it('keeps a multi-line message with accents and removes the temp file', async () => {
    write('a.txt', 'a2\n');
    const message = 'Título com ação\n\n# linha que parece comentário\nCorpo: ç ã é\n';
    await rig.service.commit(repo.root, { paths: ['a.txt'], message, amend: false });
    expect(git(repo.root, ['log', '-1', '--format=%B']).trim()).toBe(message.trim());
    expect(rig.leftovers()).toEqual([]);
  });

  it('rejects an empty selection without amend and an empty message', async () => {
    write('a.txt', 'a2\n');
    const noPaths = await failure(rig.service.commit(repo.root, { paths: [], message: 'x', amend: false }));
    expect(noPaths.code).toBe('INPUT_INVALID');
    const noMessage = await failure(rig.service.commit(repo.root, { paths: ['a.txt'], message: '  \n', amend: false }));
    expect(noMessage.code).toBe('INPUT_INVALID');
    const unknown = await failure(rig.service.commit(repo.root, { paths: ['nao-mudou.txt'], message: 'x', amend: false }));
    expect(unknown.code).toBe('INPUT_INVALID');
    expect(git(repo.root, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
  });

  it('treats a magic pathspec as a literal path', async () => {
    write('a.txt', 'a2\n');
    write('b.txt', 'b2\n');
    write('[ab].txt', 'literal\n');
    await rig.service.commit(repo.root, { paths: ['[ab].txt'], message: 'literal', amend: false });
    expect(committedFiles()).toEqual(['A\t[ab].txt']);
    const err = await failure(rig.service.commit(repo.root, { paths: [':(glob)*'], message: 'x', amend: false }));
    expect(err.code).toBe('INPUT_INVALID');
    expect(git(repo.root, ['rev-list', '--count', 'HEAD']).trim()).toBe('2');
  });

  it('restores the index when a hook refuses the commit', async () => {
    write('a.txt', 'a2\n');
    write('b.txt', 'b2\n');
    write('novo.txt', 'novo\n');
    git(repo.root, ['add', 'b.txt']);
    const hook = join(repo.root, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\necho "bloqueado pelo hook" >&2\nexit 1\n');
    chmodSync(hook, 0o755);
    const err = await failure(rig.service.commit(repo.root, { paths: ['a.txt', 'novo.txt'], message: 'x', amend: false }));
    expect(err.code).toBe('GIT_HOOK_FAILED');
    expect(err.userMessage).toContain('bloqueado pelo hook');
    expect(git(repo.root, ['diff', '--cached', '--name-only']).trim()).toBe('b.txt');
    expect(git(repo.root, ['rev-list', '--count', 'HEAD']).trim()).toBe('1');
    expect(rig.leftovers()).toEqual([]);
  });

  it('reports a missing identity and restores the index', async () => {
    git(repo.root, ['config', '--unset', 'user.name']);
    git(repo.root, ['config', '--unset', 'user.email']);
    git(repo.root, ['config', 'user.useConfigOnly', 'true']);
    const noIdentity = makeGitService({
      env: { GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    try {
      write('a.txt', 'a2\n');
      const err = await failure(noIdentity.service.commit(repo.root, { paths: ['a.txt'], message: 'x', amend: false }));
      expect(err.code).toBe('GIT_IDENTITY');
      expect(git(repo.root, ['diff', '--cached', '--name-only']).trim()).toBe('');
    } finally {
      noIdentity.cleanup();
    }
  });

  it('reports a locked index', async () => {
    write('a.txt', 'a2\n');
    const lock = join(repo.root, '.git', 'index.lock');
    writeFileSync(lock, '');
    try {
      const err = await failure(rig.service.commit(repo.root, { paths: ['a.txt'], message: 'x', amend: false }));
      expect(err.code).toBe('GIT_LOCKED');
    } finally {
      rmSync(lock, { force: true });
    }
    expect(existsSync(lock)).toBe(false);
  });

  it('serializes concurrent operations on the same repository', async () => {
    write('a.txt', 'a2\n');
    write('b.txt', 'b2\n');
    const results = await Promise.all([
      rig.service.commit(repo.root, { paths: ['a.txt'], message: 'um', amend: false }),
      rig.service.commit(repo.root, { paths: ['b.txt'], message: 'dois', amend: false }),
    ]);
    expect(results.every((r) => 'sha' in r)).toBe(true);
    expect(git(repo.root, ['rev-list', '--count', 'HEAD']).trim()).toBe('3');
  });

  it('logs git.op without the message, the paths or the hook output', async () => {
    write('a.txt', 'a2\n');
    await rig.service.commit(repo.root, { paths: ['a.txt'], message: 'segredo-da-mensagem', amend: false });
    const rec = rig.log.records.find((r) => r.event === 'git.op');
    expect(rec?.fields).toMatchObject({ op: 'commit', ok: true });
    expect(typeof rec?.fields.repoId).toBe('string');
    expect(typeof rec?.fields.durationMs).toBe('number');
    expect(rig.log.text()).not.toContain('segredo-da-mensagem');
    expect(rig.log.text()).not.toContain('a.txt');
  });

  it('commits every file when merging and refuses a partial commit', async () => {
    git(repo.root, ['checkout', '-q', '-b', 'outra']);
    write('a.txt', 'da outra\n');
    git(repo.root, ['commit', '-qam', 'na outra']);
    git(repo.root, ['checkout', '-q', 'main']);
    write('b.txt', 'b na main\n');
    git(repo.root, ['commit', '-qam', 'na main']);
    git(repo.root, ['merge', '-q', '--no-commit', '--no-ff', 'outra']);
    write('c.txt', 'c2\n');
    const partial = await failure(rig.service.commit(repo.root, { paths: ['a.txt'], message: 'x', amend: false }));
    expect(partial.code).toBe('INPUT_INVALID');
    expect(partial.userMessage).toBe('Durante um merge, todos os arquivos entram no commit.');
    const status = await rig.service.status(repo.root);
    expect(status.state).toBe('merging');
    await rig.service.commit(repo.root, {
      paths: status.changes.map((c) => c.path),
      message: status.mergeMessage ?? 'merge',
      amend: false,
    });
    expect(git(repo.root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')).toHaveLength(3);
    expect(git(repo.root, ['status', '--porcelain']).trim()).toBe('');
  });
});
