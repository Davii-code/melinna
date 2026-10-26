import { describe, expect, it } from 'vitest';
import { FileStatusService } from '../../../../src/core/files/file-status';
import { FilesService } from '../../../../src/core/files/files-service';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { registerFiles } from '../../../../src/main/ipc/register-files';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { FakeProcessRunner } from '../../../support/fakes/process-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { handleRecorder } from '../../../support/fake-core';
import { FakeClock } from '../../../support/fakes/clock';
import { FakeSearchWorker } from '../../../support/fakes/search-worker';
import { ProjectSearcher } from '../../../../src/main/search-worker';
import type { FileRoot } from '../../../../src/shared/ipc-contract';
import { currentOs } from '../../../support/os';

function setup() {
  const fs = new MemoryFileSystem();
  const log = new MemoryLogger();
  const roots = (): FileRoot[] => [{ path: '/ws', label: 'ws', kind: 'workspace' }];
  const files = new FilesService({ fs, os: currentOs, log, roots });
  const runner = new FakeProcessRunner();
  const status = new FileStatusService({ git: new GitRunner(runner, log), os: currentOs, log, roots });
  const workers: FakeSearchWorker[] = [];
  const search = new ProjectSearcher({
    createWorker: () => {
      const worker = new FakeSearchWorker();
      workers.push(worker);
      return worker;
    },
    isRootAllowed: (root) => files.containsPath(root),
    clock: new FakeClock(),
    log,
  });
  const rec = handleRecorder();
  registerFiles(rec.handle, { files, status, search, log });
  return { fs, rec, runner, workers, log };
}

describe('files IPC', () => {
  it('registers the file channels', () => {
    expect(setup().rec.channels()).toEqual([
      'files:list',
      'files:read',
      'files:roots',
      'files:searchProject',
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

describe('files IPC — busca no projeto', () => {
  const query = (over: Record<string, unknown> = {}) => ({
    roots: ['/ws'],
    text: 'alfa',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    ...over,
  });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

  it('answers with what the worker found', async () => {
    const { rec, workers } = setup();
    const pending = rec.call('files:searchProject', query({ include: '*.ts', exclude: 'dist' }));
    await tick();
    const result = { hits: [], truncated: false, scannedFiles: 4, skipped: 1 };
    workers[0]?.emitMessage({ type: 'result', result });
    expect(await pending).toEqual({ ok: true, value: result });
  });

  it('maps an invalid regular expression to its error with the message in pt-BR', async () => {
    const { rec, workers } = setup();
    const pending = rec.call('files:searchProject', query({ regex: true, text: '(' }));
    await tick();
    workers[0]?.emitMessage({
      type: 'error',
      code: 'SEARCH_REGEX_INVALID',
      message: 'Expressão regular inválida: (',
    });
    expect(await pending).toEqual({
      ok: false,
      error: { code: 'SEARCH_REGEX_INVALID', message: 'Expressão regular inválida: (' },
    });
  });

  it('refuses roots that are not registered', async () => {
    const { rec, workers } = setup();
    const r = await rec.call('files:searchProject', query({ roots: ['/etc'] }));
    expect(r).toMatchObject({ ok: false, error: { code: 'FILE_OUTSIDE_ROOT' } });
    expect(workers).toHaveLength(0);
  });

  it('a new search cancels the one that was running', async () => {
    const { rec, workers } = setup();
    const first = rec.call('files:searchProject', query());
    await tick();
    const second = rec.call('files:searchProject', query({ text: 'beta' }));
    await tick();
    expect(await first).toMatchObject({ ok: false, error: { code: 'SEARCH_CANCELLED' } });
    workers[1]?.emitMessage({
      type: 'result',
      result: { hits: [], truncated: false, scannedFiles: 0, skipped: 0 },
    });
    expect(await second).toMatchObject({ ok: true });
  });

  it('validates the shape of the query without touching the disk', async () => {
    const { rec, workers } = setup();
    const code = async (arg: unknown) => (await rec.call('files:searchProject', arg)).error?.code;
    expect(await code(undefined)).toBe('INPUT_INVALID');
    expect(await code('alfa')).toBe('INPUT_INVALID');
    expect(await code(query({ roots: 'x' }))).toBe('INPUT_INVALID');
    expect(await code(query({ roots: [1] }))).toBe('INPUT_INVALID');
    expect(await code(query({ roots: Array.from({ length: 65 }, () => '/ws') }))).toBe('INPUT_INVALID');
    expect(await code(query({ text: 7 }))).toBe('INPUT_INVALID');
    expect(await code(query({ text: 'x'.repeat(1001) }))).toBe('INPUT_INVALID');
    expect(await code(query({ caseSensitive: 'sim' }))).toBe('INPUT_INVALID');
    expect(await code(query({ wholeWord: undefined }))).toBe('INPUT_INVALID');
    expect(await code(query({ regex: 1 }))).toBe('INPUT_INVALID');
    expect(await code(query({ include: 5 }))).toBe('INPUT_INVALID');
    expect(await code(query({ exclude: 'x'.repeat(501) }))).toBe('INPUT_INVALID');
    expect(workers).toHaveLength(0);
  });

  it('never logs the searched text', async () => {
    const { rec, workers, log } = setup();
    const pending = rec.call('files:searchProject', query({ text: 'segredo-da-busca' }));
    await tick();
    workers[0]?.emitMessage({
      type: 'result',
      result: { hits: [], truncated: false, scannedFiles: 0, skipped: 0 },
    });
    await pending;
    expect(log.text()).not.toContain('segredo-da-busca');
  });
});
