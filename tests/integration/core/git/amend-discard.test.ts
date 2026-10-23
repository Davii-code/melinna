import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import { isNeedsConfirm } from '../../../../src/core/git/git-types';
import { git } from '../../../support/git-fixture';
import { createRemoteFixture, type RemoteFixture } from '../../../support/git-remote-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let fx: RemoteFixture;
let root: string;
let rig: GitServiceRig;

beforeEach(() => {
  fx = createRemoteFixture({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n', 'velho.txt': 'conteúdo longo o bastante para renomear\nlinha 2\nlinha 3\n' } });
  root = fx.local.root;
  rig = makeGitService();
});

afterEach(() => {
  fx.cleanup();
  rig.cleanup();
});

function write(rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

describe('GitService.commit with amend', () => {
  it('amends a local commit with new files and a new message', async () => {
    write('a.txt', 'a2\n');
    await rig.service.commit(root, { paths: ['a.txt'], message: 'primeiro', amend: false });
    write('b.txt', 'b2\n');
    await rig.service.commit(root, { paths: ['b.txt'], message: 'primeiro corrigido', amend: true });
    expect(git(root, ['rev-list', '--count', 'HEAD']).trim()).toBe('2');
    expect(git(root, ['log', '-1', '--format=%s']).trim()).toBe('primeiro corrigido');
    expect(git(root, ['show', '--format=', '--name-only', 'HEAD']).trim().split('\n').sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('amends only the message when paths is empty, ignoring staged files', async () => {
    write('a.txt', 'a2\n');
    await rig.service.commit(root, { paths: ['a.txt'], message: 'antes', amend: false });
    write('c.txt', 'c2\n');
    git(root, ['add', 'c.txt']);
    await rig.service.commit(root, { paths: [], message: 'depois', amend: true });
    expect(git(root, ['log', '-1', '--format=%s']).trim()).toBe('depois');
    expect(git(root, ['show', '--format=', '--name-only', 'HEAD']).trim()).toBe('a.txt');
    expect(git(root, ['diff', '--cached', '--name-only']).trim()).toBe('c.txt');
  });

  it('asks for confirmation before amending a commit that is already on the upstream', async () => {
    const before = git(root, ['rev-parse', 'HEAD']).trim();
    const remoteBefore = git(fx.remote, ['rev-parse', 'main']).trim();
    const first = await rig.service.commit(root, { paths: [], message: 'reescrito', amend: true });
    expect(isNeedsConfirm(first)).toBe(true);
    expect(first).toEqual({ needsConfirm: 'amend-published', details: {} });
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(before);

    const done = await rig.service.commit(root, { paths: [], message: 'reescrito', amend: true, confirm: ['amend-published'] });
    expect(isNeedsConfirm(done)).toBe(false);
    expect(git(root, ['rev-parse', 'HEAD']).trim()).not.toBe(before);
    expect(git(fx.remote, ['rev-parse', 'main']).trim()).toBe(remoteBefore);
  });

  it('does not treat a repository without upstream as published', async () => {
    git(root, ['branch', '--unset-upstream']);
    const r = await rig.service.commit(root, { paths: [], message: 'sem upstream', amend: true });
    expect(isNeedsConfirm(r)).toBe(false);
  });
});

describe('GitService.discard', () => {
  it('asks for confirmation listing the action per file', async () => {
    write('novo.txt', 'novo\n');
    write('a.txt', 'a2\n');
    rmSync(join(root, 'b.txt'));
    git(root, ['mv', 'velho.txt', 'novo-nome.txt']);
    const r = await rig.service.discard(root, ['novo.txt', 'a.txt', 'b.txt', 'novo-nome.txt']);
    expect(r).toEqual({
      needsConfirm: 'discard',
      details: {
        files: [
          { path: 'novo.txt', action: 'apagar' },
          { path: 'a.txt', action: 'reverter' },
          { path: 'b.txt', action: 'reverter' },
          { path: 'novo-nome.txt', action: 'reverter' },
        ],
      },
    });
    expect(existsSync(join(root, 'novo.txt'))).toBe(true);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a2\n');
  });

  it('deletes new files, reverts changed and removed ones, and restores the old name of a rename', async () => {
    write('novo.txt', 'novo\n');
    write('pasta/outro.txt', 'outro\n');
    write('a.txt', 'a2\n');
    rmSync(join(root, 'b.txt'));
    git(root, ['mv', 'velho.txt', 'novo-nome.txt']);
    const paths = ['novo.txt', 'pasta/outro.txt', 'a.txt', 'b.txt', 'novo-nome.txt'];
    const r = await rig.service.discard(root, paths, ['discard']);
    expect(isNeedsConfirm(r)).toBe(false);
    expect(existsSync(join(root, 'novo.txt'))).toBe(false);
    expect(existsSync(join(root, 'pasta/outro.txt'))).toBe(false);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a\n');
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('b\n');
    expect(existsSync(join(root, 'novo-nome.txt'))).toBe(false);
    expect(existsSync(join(root, 'velho.txt'))).toBe(true);
    expect(git(root, ['status', '--porcelain']).trim()).toBe('');
  });

  it('removes a file added to the index and rejects files without changes', async () => {
    write('indexado.txt', 'x\n');
    git(root, ['add', 'indexado.txt']);
    await rig.service.discard(root, ['indexado.txt'], ['discard']);
    expect(existsSync(join(root, 'indexado.txt'))).toBe(false);
    expect(git(root, ['status', '--porcelain']).trim()).toBe('');
    let err: MelinnaError | undefined;
    try {
      await rig.service.discard(root, ['c.txt'], ['discard']);
    } catch (e) {
      err = e as MelinnaError;
    }
    expect(err?.code).toBe('INPUT_INVALID');
  });
});
