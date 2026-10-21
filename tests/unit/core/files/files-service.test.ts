import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesService } from '../../../../src/core/files/files-service';
import { isMelinnaError } from '../../../../src/core/errors';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { currentOs } from '../../../support/os';

const ROOT = '/ws';
const OTHER = '/fora';

function setup(limits?: { maxEntries?: number; maxTextBytes?: number }) {
  const fs = new MemoryFileSystem();
  const log = new MemoryLogger();
  const service = new FilesService({
    fs,
    os: currentOs,
    log,
    roots: () => [{ path: ROOT, label: 'ws', kind: 'workspace' }],
    ...(limits ? { limits } : {}),
  });
  return { fs, log, service };
}

async function seedDir(fs: MemoryFileSystem, dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function codeOf(err: unknown): string {
  return isMelinnaError(err) ? err.code : 'NOT_MELINNA_ERROR';
}

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return codeOf(err);
  }
  return 'RESOLVED';
}

describe('FilesService.list', () => {
  it('lists directories first, in natural order, with sizes', async () => {
    const { fs, service } = setup();
    await seedDir(fs, `${ROOT}/src`);
    await seedDir(fs, `${ROOT}/docs`);
    fs.seed(`${ROOT}/a10.txt`, 'dez');
    fs.seed(`${ROOT}/a2.txt`, 'dois');
    const listing = await service.list(ROOT);
    expect(listing.path).toBe(resolve(ROOT));
    expect(listing.entries.map((e) => e.name)).toEqual(['docs', 'src', 'a2.txt', 'a10.txt']);
    expect(listing.entries[0]).toMatchObject({ kind: 'directory' });
    expect(listing.entries.find((e) => e.name === 'a2.txt')).toMatchObject({ kind: 'file', size: 4 });
    expect(listing.truncated).toBe(false);
  });

  it('caps a huge folder and reports it as truncated', async () => {
    const { fs, service } = setup({ maxEntries: 3 });
    for (const name of ['a', 'b', 'c', 'd', 'e']) fs.seed(`${ROOT}/${name}.txt`, 'x');
    const listing = await service.list(ROOT);
    expect(listing.entries).toHaveLength(3);
    expect(listing.truncated).toBe(true);
  });

  it('refuses a path outside the roots', async () => {
    const { fs, service } = setup();
    fs.seed(`${OTHER}/secret.txt`, 'segredo');
    expect(await rejection(service.list(OTHER))).toBe('FILE_OUTSIDE_ROOT');
  });

  it('refuses a symlink that points outside the roots', async () => {
    const { fs, service } = setup();
    await seedDir(fs, ROOT);
    fs.seed(`${OTHER}/secret.txt`, 'segredo');
    fs.seedLink(`${ROOT}/link`, `${OTHER}/secret.txt`);
    expect(await rejection(service.read(`${ROOT}/link`))).toBe('FILE_OUTSIDE_ROOT');
  });

  it('reports a missing folder as unreadable', async () => {
    const { service } = setup();
    expect(await rejection(service.list(`${ROOT}/nao-existe`))).toBe('FILE_UNREADABLE');
  });
});

describe('FilesService.read', () => {
  it('reads UTF-8 text', async () => {
    const { fs, service } = setup();
    fs.seed(`${ROOT}/a.txt`, 'olá ✓');
    await expect(service.read(`${ROOT}/a.txt`)).resolves.toMatchObject({
      content: 'olá ✓',
      binary: false,
      truncated: false,
      size: 8,
    });
  });

  it('flags binary content and returns no text', async () => {
    const { fs, service } = setup();
    fs.seed(`${ROOT}/img.png`, new Uint8Array([137, 80, 78, 71, 0, 1, 2]));
    const file = await service.read(`${ROOT}/img.png`);
    expect(file.binary).toBe(true);
    expect(file.content).toBe('');
  });

  it('truncates above the read limit', async () => {
    const { fs, service } = setup({ maxTextBytes: 4 });
    fs.seed(`${ROOT}/long.txt`, '0123456789');
    const file = await service.read(`${ROOT}/long.txt`);
    expect(file.truncated).toBe(true);
    expect(file.content).toBe('0123');
    expect(file.size).toBe(10);
  });

  it('refuses a directory and a missing file', async () => {
    const { fs, service } = setup();
    await seedDir(fs, `${ROOT}/src`);
    expect(await rejection(service.read(`${ROOT}/src`))).toBe('INPUT_INVALID');
    expect(await rejection(service.read(`${ROOT}/nada.txt`))).toBe('FILE_UNREADABLE');
  });
});

describe('FilesService.roots', () => {
  it('returns a copy of the current roots', () => {
    const { service } = setup();
    const roots = service.roots();
    expect(roots).toHaveLength(1);
    roots.pop();
    expect(service.roots()).toHaveLength(1);
  });
});
