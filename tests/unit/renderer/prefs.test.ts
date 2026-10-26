import { describe, expect, it } from 'vitest';
import {
  storedActiveWorkspace,
  storedSidebarPanel,
  storeActiveWorkspace,
  storeSidebarPanel,
} from '../../../src/renderer/prefs';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const broken = {
  getItem: () => {
    throw new Error('bloqueado');
  },
  setItem: () => {
    throw new Error('bloqueado');
  },
  removeItem: () => {
    throw new Error('bloqueado');
  },
};

describe('sidebar panel', () => {
  it('remembers the panel and falls back to workspaces', () => {
    const storage = memoryStorage();
    expect(storedSidebarPanel(storage)).toBe('workspaces');
    storeSidebarPanel('commit', storage);
    expect(storedSidebarPanel(storage)).toBe('commit');
    storeSidebarPanel('files', storage);
    expect(storedSidebarPanel(storage)).toBe('files');
    expect(storedSidebarPanel(memoryStorage({ 'melinna.sidebarPanel': 'abc' }))).toBe('workspaces');
    expect(storedSidebarPanel(broken)).toBe('workspaces');
  });

  it('ignores a broken storage on write', () => {
    expect(() => storeSidebarPanel('files', broken)).not.toThrow();
  });
});

describe('active workspace', () => {
  it('remembers the workspace and clears it with null', () => {
    const storage = memoryStorage();
    expect(storedActiveWorkspace(storage)).toBeNull();
    storeActiveWorkspace('ws-1', storage);
    expect(storedActiveWorkspace(storage)).toBe('ws-1');
    storeActiveWorkspace(null, storage);
    expect(storedActiveWorkspace(storage)).toBeNull();
  });

  it('treats an empty value as no workspace', () => {
    expect(storedActiveWorkspace(memoryStorage({ 'melinna.activeWorkspace': '' }))).toBeNull();
  });

  it('returns null and ignores errors from a broken storage', () => {
    expect(storedActiveWorkspace(broken)).toBeNull();
    expect(() => storeActiveWorkspace('ws-1', broken)).not.toThrow();
    expect(() => storeActiveWorkspace(null, broken)).not.toThrow();
  });
});
