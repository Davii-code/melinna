import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FilesService } from '../../../../src/core/files/files-service';
import { contentHash } from '../../../../src/core/files/hash';
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

describe('FilesService.write', () => {
  it('replaces the content when the hash still matches and reports the new one', async () => {
    const { fs, service } = setup();
    fs.seed(`${ROOT}/a.txt`, 'antigo');
    const before = await service.read(`${ROOT}/a.txt`);
    const written = await service.write(`${ROOT}/a.txt`, 'novo conteúdo', before.hash);
    expect(fs.readText(`${ROOT}/a.txt`)).toBe('novo conteúdo');
    expect(written).toMatchObject({ size: 14, hash: contentHash(new TextEncoder().encode('novo conteúdo')) });
    // nenhum temporário sobrou ao lado do arquivo
    expect(await fs.exists(`${resolve(ROOT)}/a.txt.melinna-tmp`)).toBe(false);
  });

  it('refuses to overwrite when the file changed on disk since it was read', async () => {
    const { fs, service } = setup();
    fs.seed(`${ROOT}/a.txt`, 'original');
    const before = await service.read(`${ROOT}/a.txt`);
    // outro processo (o agente, por exemplo) gravou no meio do caminho
    fs.seed(`${ROOT}/a.txt`, 'mexido pelo agente');
    expect(await rejection(service.write(`${ROOT}/a.txt`, 'meu texto', before.hash))).toBe('FILE_CONFLICT');
    expect(fs.readText(`${ROOT}/a.txt`)).toBe('mexido pelo agente');
  });

  it('refuses paths outside the roots and missing files', async () => {
    const { fs, service } = setup();
    fs.seed(`${OTHER}/secret.txt`, 'segredo');
    expect(await rejection(service.write(`${OTHER}/secret.txt`, 'x', 'a'.repeat(64)))).toBe(
      'FILE_OUTSIDE_ROOT',
    );
    expect(await rejection(service.write(`${ROOT}/nada.txt`, 'x', 'a'.repeat(64)))).toBe(
      'FILE_UNREADABLE',
    );
  });

  it('refuses content above the write limit', async () => {
    const { fs, service } = setup({ maxTextBytes: 4 });
    fs.seed(`${ROOT}/a.txt`, 'abc');
    const before = await service.read(`${ROOT}/a.txt`);
    expect(await rejection(service.write(`${ROOT}/a.txt`, '12345', before.hash))).toBe('INPUT_INVALID');
    expect(fs.readText(`${ROOT}/a.txt`)).toBe('abc');
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

describe('FilesService — workspace com várias pastas', () => {
  const FIRST = '/ws-a';
  const SECOND = '/ws-b';

  function multi(unavailable: string[] = []) {
    const fs = new MemoryFileSystem();
    const log = new MemoryLogger();
    const service = new FilesService({
      fs,
      os: currentOs,
      log,
      roots: () => [
        { path: FIRST, label: 'a', kind: 'workspace' as const, workspaceId: 'w', primary: true },
        { path: SECOND, label: 'b', kind: 'workspace' as const, workspaceId: 'w' },
      ].map((r) => (unavailable.includes(r.path) ? { ...r, available: false } : r)),
    });
    return { fs, service };
  }

  it('writes a file in any folder of the workspace, not only the primary one', async () => {
    const { fs, service } = multi();
    fs.seed(`${SECOND}/nota.txt`, 'velho');
    const hash = contentHash(new TextEncoder().encode('velho'));
    await service.write(`${SECOND}/nota.txt`, 'novo', hash);
    expect(fs.readText(`${SECOND}/nota.txt`)).toBe('novo');
  });

  it('refuses to read, list or write inside a folder flagged as unavailable', async () => {
    const { fs, service } = multi([SECOND]);
    fs.seed(`${SECOND}/nota.txt`, 'velho');
    expect(await rejection(service.list(SECOND))).toBe('FILE_OUTSIDE_ROOT');
    expect(await rejection(service.read(`${SECOND}/nota.txt`))).toBe('FILE_OUTSIDE_ROOT');
    expect(await rejection(service.write(`${SECOND}/nota.txt`, 'x', contentHash(new TextEncoder().encode('velho'))))).toBe(
      'FILE_OUTSIDE_ROOT',
    );
    expect(service.containsPath(`${SECOND}/nota.txt`)).toBe(false);
    expect(service.containsPath(`${FIRST}/qualquer`)).toBe(true);
    expect(fs.readText(`${SECOND}/nota.txt`)).toBe('velho');
  });

  it('never writes inside .git, even though the folder is a root', async () => {
    const { fs, service } = multi();
    fs.seed(`${FIRST}/.git/config`, '[core]');
    const hash = contentHash(new TextEncoder().encode('[core]'));
    expect(await rejection(service.write(`${FIRST}/.git/config`, 'x', hash))).toBe('INPUT_INVALID');
    expect(fs.readText(`${FIRST}/.git/config`)).toBe('[core]');
  });

  it('still writes files whose name merely starts with .git', async () => {
    const { fs, service } = multi();
    fs.seed(`${FIRST}/.gitignore`, 'a');
    await service.write(`${FIRST}/.gitignore`, 'b', contentHash(new TextEncoder().encode('a')));
    expect(fs.readText(`${FIRST}/.gitignore`)).toBe('b');
  });
});
