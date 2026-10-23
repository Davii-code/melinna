import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import type { GitIo } from '../../../../src/core/git/git-service';
import type { Confirm } from '../../../../src/core/git/git-types';
import { createTempRepo, git } from '../../../support/git-fixture';
import { createRemoteFixture, type RemoteFixture } from '../../../support/git-remote-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let fx: RemoteFixture;
let root: string;
let rig: GitServiceRig;

beforeEach(() => {
  fx = createRemoteFixture({ files: { 'a.txt': 'linha 1\nlinha 2\nlinha 3\n' } });
  root = fx.local.root;
  rig = makeGitService();
});

afterEach(() => {
  fx.cleanup();
  rig.cleanup();
});

function io(confirm: Confirm[] = []): GitIo & { confirm: Confirm[]; progress: ReturnType<typeof vi.fn> } {
  const progress = vi.fn();
  return { signal: new AbortController().signal, onProgress: progress, confirm, progress };
}

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

function commitLocal(file: string, content: string, message = 'local'): void {
  writeFileSync(join(root, file), content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

describe('GitService fetch', () => {
  it('updates behind and the last fetch time', async () => {
    const before = await rig.service.status(root);
    expect(before).toMatchObject({ ahead: 0, behind: 0, hasRemote: true, upstream: 'origin/main' });
    fx.pushFromOther({ 'b.txt': 'b\n' });
    await rig.service.fetch(root, io());
    const after = await rig.service.status(root);
    expect(after.behind).toBe(1);
    expect(after.ahead).toBe(0);
    expect(after.lastFetchAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Date.now() - Date.parse(after.lastFetchAt!)).toBeLessThan(60_000);
  });

  it('reports progress while fetching', async () => {
    fx.pushFromOther({ 'grande.bin': 'x'.repeat(200_000) });
    const o = io();
    await rig.service.fetch(root, o);
    expect(o.progress).toHaveBeenCalledWith('Iniciando');
    expect(o.progress.mock.calls.length).toBeGreaterThan(1);
  });
});

describe('GitService push', () => {
  it('asks to confirm a push to the default branch, then sends and clears ahead', async () => {
    commitLocal('a.txt', 'novo\n');
    expect((await rig.service.status(root)).ahead).toBe(1);
    expect(await rig.service.checkPush(root)).toEqual({
      needsConfirm: 'push-main',
      details: { branch: 'main', remote: 'origin' },
    });
    await rig.service.push(root, io(['push-main']));
    expect((await rig.service.status(root)).ahead).toBe(0);
    expect(git(fx.remote, ['rev-parse', 'main']).trim()).toBe(fx.local.head());
  });

  it('refuses to start a push that still needs confirmation', async () => {
    commitLocal('a.txt', 'novo\n');
    const err = await failure(rig.service.push(root, io()));
    expect(err.code).toBe('INPUT_INVALID');
    expect(git(fx.remote, ['rev-parse', 'main']).trim()).not.toBe(fx.local.head());
  });

  it('asks to set the upstream for a new branch and publishes it when confirmed', async () => {
    await rig.service.createBranch(root, 'feature/nova');
    commitLocal('f.txt', 'f\n');
    expect(await rig.service.checkPush(root)).toEqual({
      needsConfirm: 'set-upstream',
      details: { branch: 'feature/nova', remote: 'origin' },
    });
    expect(await rig.service.checkPush(root, ['set-upstream'])).toBeNull();
    await rig.service.push(root, io(['set-upstream']));
    const status = await rig.service.status(root);
    expect(status).toMatchObject({ upstream: 'origin/feature/nova', ahead: 0 });
    expect(git(fx.remote, ['rev-parse', 'feature/nova']).trim()).toBe(fx.local.head());
  });

  it('uses refs/remotes/<remote>/HEAD to find the default branch', async () => {
    git(root, ['push', '-q', 'origin', 'main:trunk']);
    git(root, ['fetch', '-q', 'origin']);
    git(root, ['remote', 'set-head', 'origin', 'trunk']);
    expect((await rig.service.status(root)).defaultRemoteBranch).toBe('trunk');
    commitLocal('a.txt', 'novo\n');
    expect(await rig.service.checkPush(root)).toBeNull();
    await rig.service.push(root, io());
    expect(git(fx.remote, ['rev-parse', 'main']).trim()).toBe(fx.local.head());
  });

  it('falls back to main when the remote has no HEAD reference', async () => {
    git(root, ['remote', 'set-head', 'origin', '--delete']);
    expect((await rig.service.status(root)).defaultRemoteBranch).toBe('main');
  });

  it('maps a rejected push to GIT_REJECTED', async () => {
    fx.pushFromOther({ 'b.txt': 'b\n' });
    commitLocal('a.txt', 'local\n');
    const err = await failure(rig.service.push(root, io(['push-main'])));
    expect(err.code).toBe('GIT_REJECTED');
    expect(err.userMessage).toBe('O remoto recusou o envio porque tem commits novos. Faça pull antes.');
  });

  it('does not offer push without a remote or with a detached head', async () => {
    const lonely = createTempRepo();
    try {
      const status = await rig.service.status(lonely.root);
      expect(status).toMatchObject({ hasRemote: false, defaultRemoteBranch: null, upstream: null, ahead: null });
      expect((await failure(rig.service.checkPush(lonely.root))).code).toBe('INPUT_INVALID');
      expect((await failure(rig.service.checkPull(lonely.root))).code).toBe('INPUT_INVALID');
    } finally {
      lonely.cleanup();
    }
    git(root, ['checkout', '-q', '--detach']);
    expect((await failure(rig.service.checkPush(root))).code).toBe('INPUT_INVALID');
  });
});

describe('GitService pull', () => {
  it('integrates remote commits with a merge', async () => {
    fx.pushFromOther({ 'b.txt': 'do outro\n' });
    await rig.service.fetch(root, io());
    expect(await rig.service.checkPull(root)).toBeNull();
    const result = await rig.service.pull(root, io());
    expect(result).toEqual({ conflicts: [] });
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('do outro\n');
    expect((await rig.service.status(root)).behind).toBe(0);
  });

  it('merges (not rebases) when local and remote diverged', async () => {
    fx.pushFromOther({ 'b.txt': 'do outro\n' });
    commitLocal('c.txt', 'meu\n');
    await rig.service.pull(root, io());
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
    expect(parents).toHaveLength(3);
    expect(existsSync(join(root, 'b.txt'))).toBe(true);
    expect(existsSync(join(root, 'c.txt'))).toBe(true);
  });

  it('asks for confirmation when the tree has uncommitted changes', async () => {
    writeFileSync(join(root, 'a.txt'), 'sujo\n');
    writeFileSync(join(root, 'novo.txt'), 'novo\n');
    const needs = await rig.service.checkPull(root);
    expect(needs).toEqual({
      needsConfirm: 'merge-dirty',
      details: { files: [{ path: 'a.txt' }, { path: 'novo.txt' }] },
    });
    expect(await rig.service.checkPull(root, ['merge-dirty'])).toBeNull();
  });

  it('returns the conflicting files and leaves the repository merging', async () => {
    fx.pushFromOther({ 'a.txt': 'linha 1\noutro\nlinha 3\n' });
    commitLocal('a.txt', 'linha 1\nmeu\nlinha 3\n');
    const result = await rig.service.pull(root, io());
    expect(result).toEqual({ conflicts: ['a.txt'] });
    const status = await rig.service.status(root);
    expect(status.state).toBe('merging');
    expect(status.changes).toMatchObject([{ path: 'a.txt', kind: 'conflict' }]);
  });

  it('refuses to pull a branch without upstream', async () => {
    await rig.service.createBranch(root, 'sem-upstream');
    expect((await failure(rig.service.checkPull(root))).code).toBe('INPUT_INVALID');
  });
});
