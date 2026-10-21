import { describe, expect, it } from 'vitest';
import {
  relativeToRoot,
  statusForDir,
  statusForPath,
  statusLabel,
  statusLetter,
} from '../../../src/renderer/files/decorations';
import type { FileChange } from '../../../src/shared/ipc-contract';

const STATUS: Record<string, FileChange> = {
  'a.ts': 'modified',
  'src/b.ts': 'added',
  'src/deep/c.ts': 'untracked',
  'src/velho.ts': 'deleted',
};

describe('relativeToRoot', () => {
  it('strips the root and normalises separators to the git form', () => {
    expect(relativeToRoot('/ws', '/ws/src/a.ts')).toBe('src/a.ts');
    expect(relativeToRoot('C:\\ws', 'C:\\ws\\src\\a.ts')).toBe('src/a.ts');
    expect(relativeToRoot('/ws', '/ws/')).toBe('');
  });
});

describe('statusForPath', () => {
  it('finds the file status by relative path', () => {
    expect(statusForPath(STATUS, '/ws', '/ws/a.ts')).toBe('modified');
    expect(statusForPath(STATUS, '/ws', '/ws/src/b.ts')).toBe('added');
    expect(statusForPath(STATUS, '/ws', '/ws/limpo.ts')).toBeNull();
  });
});

describe('statusForDir', () => {
  it('reports the most severe change below the folder', () => {
    expect(statusForDir(STATUS, '/ws', '/ws/src')).toBe('deleted');
  });

  it('ignores folders without changes below them and the root itself', () => {
    expect(statusForDir(STATUS, '/ws', '/ws/docs')).toBeNull();
    expect(statusForDir(STATUS, '/ws', '/ws')).toBeNull();
  });

  it('does not confuse a sibling folder with the same prefix', () => {
    const status: Record<string, FileChange> = { 'src2/a.ts': 'modified' };
    expect(statusForDir(status, '/ws', '/ws/src')).toBeNull();
  });
});

describe('labels', () => {
  it('has a letter and a description for every change kind', () => {
    const kinds: FileChange[] = ['added', 'modified', 'deleted', 'renamed', 'untracked'];
    const letters = kinds.map(statusLetter);
    expect(letters).toEqual(['A', 'M', 'D', 'R', 'U']);
    expect(kinds.map(statusLabel)).toEqual([
      'adicionado',
      'modificado',
      'apagado',
      'renomeado',
      'não rastreado',
    ]);
  });
});
