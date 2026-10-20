import { describe, expect, it } from 'vitest';
import { makePaths, normalizeRepoPath, repoIdOf } from '../../../src/core/paths';

describe('paths', () => {
  it('lays out userData as in the data model (POSIX)', () => {
    const p = makePaths('/home/u/.config/melinna/', 'linux');
    expect(p.state).toBe('/home/u/.config/melinna/state.json');
    expect(p.userCatalog).toBe('/home/u/.config/melinna/catalog.json');
    expect(p.hostRegistry).toBe('/home/u/.config/melinna/host/registry.json');
    expect(p.hostToken).toBe('/home/u/.config/melinna/host/token');
    expect(p.hostEndpoint).toBe('/home/u/.config/melinna/host/endpoint');
    expect(p.hostSocket).toBe('/home/u/.config/melinna/host/sock');
    expect(p.mainLog).toBe('/home/u/.config/melinna/logs/main.log');
    expect(p.hostLog).toBe('/home/u/.config/melinna/logs/host.log');
    expect(p.scrollbackDir('e1')).toBe('/home/u/.config/melinna/scrollback/e1');
    expect(p.worktree('r1', 'e1')).toBe('/home/u/.config/melinna/worktrees/r1/e1');
    expect(p.lease('r1', 'e1')).toBe('/home/u/.config/melinna/worktrees/r1/e1.lease');
  });

  it('lays out userData on Windows', () => {
    const p = makePaths('C:\\Users\\u\\AppData\\Roaming\\Melinna', 'win32');
    expect(p.worktree('r', 'e')).toBe('C:\\Users\\u\\AppData\\Roaming\\Melinna\\worktrees\\r\\e');
  });

  it('checks containment in the worktrees folder', () => {
    const p = makePaths('/data', 'linux');
    expect(p.isInsideWorktrees('/data/worktrees/r/e')).toBe(true);
    expect(p.isInsideWorktrees('/data/worktrees')).toBe(false);
    expect(p.isInsideWorktrees('/data/worktrees/../state.json')).toBe(false);
    expect(p.isInsideWorktrees('/etc')).toBe(false);
    const w = makePaths('C:\\Data', 'win32');
    expect(w.isInsideWorktrees('c:\\data\\WORKTREES\\r\\e')).toBe(true);
    expect(w.isInsideWorktrees('D:\\data\\worktrees\\r')).toBe(false);
  });

  it('derives repoId from the normalized path, case-insensitive on Windows', () => {
    expect(repoIdOf('/repo/a', 'linux')).toMatch(/^[0-9a-f]{16}$/);
    expect(repoIdOf('/repo/a/', 'linux')).toBe(repoIdOf('/repo/a', 'linux'));
    expect(repoIdOf('/repo/A', 'linux')).not.toBe(repoIdOf('/repo/a', 'linux'));
    expect(repoIdOf('C:\\Repo\\A', 'win32')).toBe(repoIdOf('c:\\repo\\a\\', 'win32'));
    expect(normalizeRepoPath('C:\\', 'win32')).toBe('c:\\');
  });
});
