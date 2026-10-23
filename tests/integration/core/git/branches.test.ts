import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MelinnaError } from '../../../../src/core/errors';
import { createRemoteFixture, type RemoteFixture } from '../../../support/git-remote-fixture';
import { git } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let fx: RemoteFixture;
let root: string;
let rig: GitServiceRig;

beforeEach(() => {
  fx = createRemoteFixture({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
  root = fx.local.root;
  rig = makeGitService();
});

afterEach(() => {
  fx.cleanup();
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

const currentBranch = () => git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();

describe('GitService.branches', () => {
  it('lists local and remote branches marking the current one', async () => {
    git(root, ['branch', 'outra']);
    const list = await rig.service.branches(root);
    expect(list).toContainEqual({ name: 'main', kind: 'local', current: true, upstream: 'origin/main' });
    expect(list).toContainEqual({ name: 'outra', kind: 'local', current: false });
    expect(list).toContainEqual({ name: 'origin/main', kind: 'remote', current: false });
    expect(list.some((b) => b.name.endsWith('/HEAD'))).toBe(false);
    expect(list.filter((b) => b.current)).toHaveLength(1);
  });
});

describe('GitService.createBranch', () => {
  it('creates a valid branch from the current one and switches to it', async () => {
    await rig.service.createBranch(root, 'feature/nova');
    expect(currentBranch()).toBe('feature/nova');
    expect(git(root, ['rev-parse', 'HEAD']).trim()).toBe(git(root, ['rev-parse', 'main']).trim());
  });

  it('keeps uncommitted changes when creating a branch', async () => {
    writeFileSync(join(root, 'a.txt'), 'sujo\n');
    await rig.service.createBranch(root, 'com-sujeira');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('sujo\n');
  });

  it('rejects invalid names without touching the repository', async () => {
    for (const name of ['@{-1}', '-x', '--orphan', 'com espaço', 'a..b', 'x.lock', 'fim/', '', 'a~b', 'a:b', 'a\nb']) {
      const err = await failure(rig.service.createBranch(root, name));
      expect(err.code, `nome ${JSON.stringify(name)}`).toBe('INPUT_INVALID');
    }
    expect(currentBranch()).toBe('main');
    expect(git(root, ['branch', '--list']).trim()).toBe('* main');
  });

  it('explains the naming rule and refuses an existing name', async () => {
    const bad = await failure(rig.service.createBranch(root, 'com espaço'));
    expect(bad.userMessage).toMatch(/Nome de branch inválido/);
    git(root, ['branch', 'ja-existe']);
    const dup = await failure(rig.service.createBranch(root, 'ja-existe'));
    expect(dup.code).toBe('INPUT_INVALID');
    expect(dup.userMessage).toContain('já existe');
  });
});

describe('GitService.checkout', () => {
  it('switches to a local branch', async () => {
    git(root, ['branch', 'outra']);
    expect(await rig.service.checkout(root, 'outra')).toBeUndefined();
    expect(currentBranch()).toBe('outra');
  });

  it('refuses a branch that does not exist', async () => {
    for (const name of ['nao-existe', 'origin/nao-existe', 'HEAD~1', '-b']) {
      const err = await failure(rig.service.checkout(root, name));
      expect(err.code).toBe('INPUT_INVALID');
    }
    expect(currentBranch()).toBe('main');
  });

  it('asks for confirmation listing the pending files, then switches carrying them', async () => {
    git(root, ['branch', 'outra']);
    writeFileSync(join(root, 'a.txt'), 'sujo\n');
    writeFileSync(join(root, 'novo.txt'), 'novo\n');
    const needs = await rig.service.checkout(root, 'outra');
    expect(needs).toEqual({
      needsConfirm: 'checkout-dirty',
      details: { files: [{ path: 'a.txt' }, { path: 'novo.txt' }], branch: 'outra' },
    });
    expect(currentBranch()).toBe('main');
    expect(await rig.service.checkout(root, 'outra', ['checkout-dirty'])).toBeUndefined();
    expect(currentBranch()).toBe('outra');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('sujo\n');
  });

  it('creates the local branch tracking a remote-only branch', async () => {
    git(fx.other, ['checkout', '-q', '-b', 'so-no-remoto']);
    writeFileSync(join(fx.other, 'remoto.txt'), 'r\n');
    git(fx.other, ['add', '-A']);
    git(fx.other, ['commit', '-q', '-m', 'remoto']);
    git(fx.other, ['push', '-q', 'origin', 'so-no-remoto']);
    git(root, ['fetch', '-q', 'origin']);
    await rig.service.checkout(root, 'origin/so-no-remoto');
    expect(currentBranch()).toBe('so-no-remoto');
    const status = await rig.service.status(root);
    expect(status.upstream).toBe('origin/so-no-remoto');
    expect(readFileSync(join(root, 'remoto.txt'), 'utf8')).toBe('r\n');
  });

  it('switches to the existing local branch when the remote one has a local twin', async () => {
    git(root, ['branch', 'gemea']);
    git(root, ['push', '-q', 'origin', 'gemea']);
    git(root, ['fetch', '-q', 'origin']);
    await rig.service.checkout(root, 'origin/gemea');
    expect(currentBranch()).toBe('gemea');
  });

  it('returns git’s own message when it refuses the switch', async () => {
    git(root, ['checkout', '-q', '-b', 'outra']);
    writeFileSync(join(root, 'a.txt'), 'na outra\n');
    git(root, ['commit', '-qam', 'muda a']);
    git(root, ['checkout', '-q', 'main']);
    writeFileSync(join(root, 'a.txt'), 'sujo na main\n');
    const err = await failure(rig.service.checkout(root, 'outra', ['checkout-dirty']));
    expect(err.code).toBe('GIT_FAILED');
    expect(err.userMessage).toMatch(/would be overwritten/);
    expect(currentBranch()).toBe('main');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('sujo na main\n');
  });
});
