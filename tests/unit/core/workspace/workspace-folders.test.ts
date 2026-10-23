import { describe, expect, it } from 'vitest';
import { repoIdOf } from '../../../../src/core/paths';
import {
  addFolder,
  derivedRepo,
  extrasOf,
  MAX_FOLDERS,
  normalizeFolders,
  primaryOf,
  removeFolder,
  setPrimary,
} from '../../../../src/core/workspace/workspace-folders';

const paths = (set: { folders: { path: string }[] }) => set.folders.map((f) => f.path);

describe('normalizeFolders', () => {
  it('keeps the order, resolves paths and marks the first as primary by default', () => {
    const set = normalizeFolders(['/a/', '/b/../c'], 'linux');
    expect(paths(set)).toEqual(['/a', '/c']);
    expect(set.primaryFolderId).toBe(set.folders[0]?.id);
  });

  it('marks the folder at primaryIndex as primary', () => {
    const set = normalizeFolders(['/a', '/b', '/c'], 'linux', 2);
    expect(primaryOf(set).path).toBe('/c');
  });

  it('refuses an empty list and a primaryIndex outside the list', () => {
    expect(() => normalizeFolders([], 'linux')).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID' }),
    );
    expect(() => normalizeFolders(['/a'], 'linux', 1)).toThrow(
      expect.objectContaining({ userMessage: 'Escolha a pasta principal entre as pastas do workspace.' }),
    );
    expect(() => normalizeFolders(['/a'], 'linux', -1)).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID' }),
    );
  });

  it('refuses repeated paths in the list', () => {
    expect(() => normalizeFolders(['/a', '/a/'], 'linux')).toThrow(
      expect.objectContaining({ userMessage: 'A pasta /a/ já está neste workspace.' }),
    );
  });

  it('refuses more than 32 folders', () => {
    const many = Array.from({ length: MAX_FOLDERS + 1 }, (_, i) => `/p${i}`);
    expect(() => normalizeFolders(many, 'linux')).toThrow(
      expect.objectContaining({ userMessage: 'Um workspace pode ter no máximo 32 pastas.' }),
    );
    expect(normalizeFolders(many.slice(0, MAX_FOLDERS), 'linux').folders).toHaveLength(MAX_FOLDERS);
  });
});

describe('addFolder', () => {
  it('appends to the end and keeps the primary', () => {
    const set = normalizeFolders(['/a', '/b'], 'linux', 1);
    const next = addFolder(set, '/c', 'linux');
    expect(paths(next)).toEqual(['/a', '/b', '/c']);
    expect(next.primaryFolderId).toBe(set.primaryFolderId);
  });

  it('refuses a duplicate, ignoring case only on Windows', () => {
    const win = normalizeFolders(['C:\\Work\\App'], 'win32');
    expect(() => addFolder(win, 'c:\\work\\app', 'win32')).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID' }),
    );
    const linux = normalizeFolders(['/Work/App'], 'linux');
    expect(paths(addFolder(linux, '/work/app', 'linux'))).toEqual(['/Work/App', '/work/app']);
  });

  it('refuses a 33rd folder', () => {
    const set = normalizeFolders(
      Array.from({ length: MAX_FOLDERS }, (_, i) => `/p${i}`),
      'linux',
    );
    expect(() => addFolder(set, '/extra', 'linux')).toThrow(
      expect.objectContaining({ userMessage: 'Um workspace pode ter no máximo 32 pastas.' }),
    );
  });
});

describe('removeFolder', () => {
  it('refuses to remove the only folder', () => {
    const set = normalizeFolders(['/a'], 'linux');
    expect(() => removeFolder(set, set.primaryFolderId)).toThrow(
      expect.objectContaining({ userMessage: 'Um workspace precisa de ao menos uma pasta.' }),
    );
  });

  it('keeps the primary when another folder is removed', () => {
    const set = normalizeFolders(['/a', '/b', '/c'], 'linux', 2);
    const next = removeFolder(set, set.folders[0]?.id as string);
    expect(paths(next)).toEqual(['/b', '/c']);
    expect(primaryOf(next).path).toBe('/c');
  });

  it('promotes the next folder when the primary is removed', () => {
    const set = normalizeFolders(['/a', '/b', '/c'], 'linux', 0);
    expect(primaryOf(removeFolder(set, set.primaryFolderId)).path).toBe('/b');
    const middle = setPrimary(set, set.folders[1]?.id as string);
    expect(primaryOf(removeFolder(middle, middle.primaryFolderId)).path).toBe('/c');
  });

  it('promotes the previous folder when the primary was the last', () => {
    const set = normalizeFolders(['/a', '/b', '/c'], 'linux', 2);
    expect(primaryOf(removeFolder(set, set.primaryFolderId)).path).toBe('/b');
  });

  it('refuses an unknown folder id', () => {
    const set = normalizeFolders(['/a', '/b'], 'linux');
    expect(() => removeFolder(set, 'nope')).toThrow(
      expect.objectContaining({ userMessage: 'Pasta não encontrada neste workspace.' }),
    );
  });
});

describe('setPrimary, primaryOf, extrasOf', () => {
  it('changes the primary to an existing folder', () => {
    const set = normalizeFolders(['/a', '/b'], 'linux');
    const next = setPrimary(set, set.folders[1]?.id as string);
    expect(primaryOf(next).path).toBe('/b');
    expect(extrasOf(next).map((f) => f.path)).toEqual(['/a']);
  });

  it('refuses an unknown folder id', () => {
    const set = normalizeFolders(['/a'], 'linux');
    expect(() => setPrimary(set, 'nope')).toThrow(expect.objectContaining({ code: 'INPUT_INVALID' }));
  });

  it('lists the extras in workspace order, empty when there is one folder', () => {
    expect(extrasOf(normalizeFolders(['/a', '/b', '/c'], 'linux', 1)).map((f) => f.path)).toEqual([
      '/a',
      '/c',
    ]);
    expect(extrasOf(normalizeFolders(['/a'], 'linux'))).toEqual([]);
  });
});

describe('derivedRepo', () => {
  it('derives repoPath and repoId from the primary folder', () => {
    const set = normalizeFolders(['/a', '/b'], 'linux', 1);
    expect(derivedRepo(set, 'linux')).toEqual({ repoPath: '/b', repoId: repoIdOf('/b', 'linux') });
  });
});
