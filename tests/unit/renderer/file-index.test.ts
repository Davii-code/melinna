import { describe, expect, it } from 'vitest';
import { buildFileIndex, filterIndex, SKIP_DIRS } from '../../../src/renderer/files/index';
import type { DirectoryListing, Result } from '../../../src/shared/ipc-contract';
import { okR } from '../../support/fake-api';

type Tree = Record<string, { name: string; kind: 'file' | 'directory' }[]>;

function lister(tree: Tree) {
  return (path: string): Promise<Result<DirectoryListing>> => {
    const entries = tree[path] ?? [];
    return Promise.resolve(
      okR({
        path,
        truncated: false,
        entries: entries.map((e) => ({
          name: e.name,
          path: `${path}/${e.name}`,
          kind: e.kind,
          size: 0,
        })),
      }),
    );
  };
}

const TREE: Tree = {
  '/ws': [
    { name: 'src', kind: 'directory' },
    { name: 'node_modules', kind: 'directory' },
    { name: 'README.md', kind: 'file' },
  ],
  '/ws/src': [
    { name: 'a.ts', kind: 'file' },
    { name: 'b.ts', kind: 'file' },
  ],
  '/ws/node_modules': [{ name: 'lixo.ts', kind: 'file' }],
};

describe('buildFileIndex', () => {
  it('walks the tree, skips ignored folders and collects files', async () => {
    const index = await buildFileIndex(lister(TREE), '/ws');
    expect(index.truncated).toBe(false);
    expect(index.files.sort()).toEqual(['/ws/README.md', '/ws/src/a.ts', '/ws/src/b.ts']);
    expect(SKIP_DIRS.has('node_modules')).toBe(true);
  });

  it('stops at the cap and reports the index as incomplete', async () => {
    const index = await buildFileIndex(lister(TREE), '/ws', 2);
    expect(index.files).toHaveLength(2);
    expect(index.truncated).toBe(true);
  });

  it('keeps going when one folder cannot be listed', async () => {
    const list = lister(TREE);
    const failing = (path: string) =>
      path === '/ws/src'
        ? Promise.resolve<Result<DirectoryListing>>({
            ok: false,
            error: { code: 'FILE_UNREADABLE', message: 'sem permissão' },
          })
        : list(path);
    const index = await buildFileIndex(failing, '/ws');
    expect(index.files).toEqual(['/ws/README.md']);
  });
});

describe('filterIndex', () => {
  const files = ['/ws/src/a.ts', '/ws/src/b.ts', '/ws/README.md', '/ws/docs/arq-ts.md'];

  it('matches every term, preferring hits in the file name', () => {
    expect(filterIndex(files, 'a.ts')).toEqual(['/ws/src/a.ts']);
    expect(filterIndex(files, 'ts')).toEqual(['/ws/src/a.ts', '/ws/src/b.ts', '/ws/docs/arq-ts.md']);
  });

  it('returns everything for an empty query and nothing for a miss', () => {
    expect(filterIndex(files, '')).toHaveLength(4);
    expect(filterIndex(files, 'zzz')).toEqual([]);
  });

  it('honours the result limit', () => {
    expect(filterIndex(files, '', 2)).toHaveLength(2);
  });
});
