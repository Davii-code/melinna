import { describe, expect, it } from 'vitest';
import { FileStatusService } from '../../../../src/core/files/file-status';
import { FilesService } from '../../../../src/core/files/files-service';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { registerFiles } from '../../../../src/main/ipc/register-files';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { FakeProcessRunner } from '../../../support/fakes/process-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { handleRecorder } from '../../../support/fake-core';
import type { FileRoot } from '../../../../src/shared/ipc-contract';
import { currentOs } from '../../../support/os';

function setup() {
  const fs = new MemoryFileSystem();
  const log = new MemoryLogger();
  const roots = (): FileRoot[] => [{ path: '/ws', label: 'ws', kind: 'workspace' }];
  const files = new FilesService({ fs, os: currentOs, log, roots });
  const runner = new FakeProcessRunner();
  const status = new FileStatusService({ git: new GitRunner(runner, log), os: currentOs, log, roots });
  const rec = handleRecorder();
  registerFiles(rec.handle, { files, status, log });
  return { fs, rec, runner };
}

describe('files IPC', () => {
  it('registers the file channels', () => {
    expect(setup().rec.channels()).toEqual([
      'files:list',
      'files:read',
      'files:roots',
      'files:status',
      'files:write',
    ]);
  });

  it('answers roots, listing and content', async () => {
    const { fs, rec } = setup();
    fs.seed('/ws/a.txt', 'oi');
    expect(await rec.call('files:roots')).toEqual({
      ok: true,
      value: [{ path: '/ws', label: 'ws', kind: 'workspace' }],
    });
    const listed = await rec.call('files:list', '/ws');
    expect(listed).toMatchObject({ ok: true, value: { entries: [{ name: 'a.txt', kind: 'file' }] } });
    const read = await rec.call('files:read', '/ws/a.txt');
    expect(read).toMatchObject({ ok: true, value: { content: 'oi', binary: false } });
  });

  it('rejects mistyped arguments without touching the file system', async () => {
    const { rec } = setup();
    expect(await rec.call('files:list')).toMatchObject({ ok: false, error: { code: 'INPUT_INVALID' } });
    expect(await rec.call('files:list', 42)).toMatchObject({ ok: false, error: { code: 'INPUT_INVALID' } });
    expect(await rec.call('files:read', '')).toMatchObject({ ok: false, error: { code: 'INPUT_INVALID' } });
    expect(await rec.call('files:roots', 'x')).toMatchObject({ ok: false, error: { code: 'INPUT_INVALID' } });
  });

  it('returns FILE_OUTSIDE_ROOT as a normal error result', async () => {
    const { fs, rec } = setup();
    fs.seed('/fora/secret.txt', 'segredo');
    const r = await rec.call('files:read', '/fora/secret.txt');
    expect(r).toMatchObject({ ok: false, error: { code: 'FILE_OUTSIDE_ROOT' } });
  });
});
