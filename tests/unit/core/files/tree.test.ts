import { describe, expect, it } from 'vitest';
import {
  isInsideRoot,
  looksBinary,
  naturalCompare,
  normalizeForCompare,
  pickRoot,
} from '../../../../src/core/files/tree';

describe('isInsideRoot', () => {
  it('accepts the root itself and paths below it', () => {
    expect(isInsideRoot('/r', '/r', 'linux')).toBe(true);
    expect(isInsideRoot('/r', '/r/a/b.txt', 'linux')).toBe(true);
  });

  it('rejects parents, siblings and traversals', () => {
    expect(isInsideRoot('/r', '/', 'linux')).toBe(false);
    expect(isInsideRoot('/r', '/outro', 'linux')).toBe(false);
    expect(isInsideRoot('/r', '/r-irmão/x', 'linux')).toBe(false);
    expect(isInsideRoot('/r', '/r/../fora', 'linux')).toBe(false);
  });

  it('compares case-insensitively on Windows and case-sensitively elsewhere', () => {
    expect(isInsideRoot('C:\\Repo', 'c:\\repo\\src\\a.ts', 'win32')).toBe(true);
    expect(isInsideRoot('/Repo', '/repo/a.ts', 'linux')).toBe(false);
  });
});

describe('pickRoot', () => {
  it('prefers the deepest root that contains the target', () => {
    const roots = ['/repo', '/repo/.worktrees/x'];
    expect(pickRoot(roots, '/repo/.worktrees/x/src/a.ts', 'linux')).toBe('/repo/.worktrees/x');
    expect(pickRoot(roots, '/repo/src/a.ts', 'linux')).toBe('/repo');
  });

  it('returns null when no root contains the target', () => {
    expect(pickRoot(['/a', '/b'], '/c/d', 'linux')).toBeNull();
  });
});

describe('naturalCompare', () => {
  it('orders numbers by value and keeps case from scattering the list', () => {
    expect(['f10', 'f2'].sort(naturalCompare)).toEqual(['f2', 'f10']);
    expect(['B', 'a'].sort(naturalCompare)).toEqual(['a', 'B']);
    expect(naturalCompare('a', 'a')).toBe(0);
    expect(naturalCompare('a', 'A')).not.toBe(0);
  });
});

describe('normalizeForCompare', () => {
  it('lowercases only on Windows', () => {
    expect(normalizeForCompare('C:\\Repo\\A', 'win32')).toBe('c:\\repo\\a');
    expect(normalizeForCompare('/Repo/A', 'linux')).toBe('/Repo/A');
  });
});

describe('looksBinary', () => {
  it('detects a NUL byte in the first bytes and accepts plain UTF-8', () => {
    expect(looksBinary(new Uint8Array([104, 105]))).toBe(false);
    expect(looksBinary(new TextEncoder().encode('acentuação ✓'))).toBe(false);
    expect(looksBinary(new Uint8Array([65, 0, 66]))).toBe(true);
  });
});
