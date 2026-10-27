import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliOrchestrationRuntime } from '../../../../src/adapters/orchestration-runtime';
import { JsonOrchestrationStore } from '../../../../src/adapters/orchestration-store';
import { NodeFileSystem } from '../../../../src/adapters/node-fs';
import { nodePlatform } from '../../../../src/adapters/node-platform';
import type { CatalogService } from '../../../../src/core/catalog/catalog-service';
import { resolveLauncher } from '../../../../src/core/catalog/detect';
import { DEFAULT_TEAM } from '../../../../src/core/orchestration/types';
import { createTempRepo, git } from '../../../support/git-fixture';
import { removeDirRecursive } from '../../../support/temp-dirs';

vi.mock('../../../../src/core/catalog/detect', () => ({ resolveLauncher: vi.fn() }));
const temporary: string[] = [];
const fixture = join(__dirname, '../../../fixtures/fake-orchestration-agent.mjs');
beforeEach(() =>
  vi.mocked(resolveLauncher).mockResolvedValue({ file: process.execPath, prefixArgs: [fixture] }),
);
afterEach(() => {
  for (const path of temporary.splice(0)) removeDirRecursive(path);
});
function runtime(mode = '') {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-orchestration-test-')));
  temporary.push(root);
  const catalog = { agent: async () => ({}) } as unknown as CatalogService;
  return {
    root,
    runtime: new CliOrchestrationRuntime({
      catalog,
      root,
      fs: new NodeFileSystem(),
      platform: nodePlatform(),
      env: { ...(process.env as Record<string, string>), MELINNA_FAKE_MODE: mode },
    }),
  };
}
function request(cwd: string, provider: 'claude' | 'codex' = 'claude') {
  return {
    role: { ...DEFAULT_TEAM.coordinator, provider },
    cwd,
    prompt: 'read fixture',
    signal: new AbortController().signal,
    timeoutMs: 5000,
    onEvent: vi.fn(),
  };
}
describe('structured CLI runtime with real fake-agent processes', () => {
  it.each(['claude', 'codex'] as const)(
    'parses %s final events, session identities and reported usage',
    async (provider) => {
      const f = runtime();
      const req = request(f.root, provider);
      const output = await f.runtime.turn(req);
      expect(output.text).toBe('result-' + provider);
      expect(output.sessionId).toBeTruthy();
      expect(output.usage?.outputTokens).toBe(5);
      expect(req.onEvent).toHaveBeenCalledWith('text', 'result-' + provider);
    },
  );
  it.each([
    ['bad-json', /JSON/],
    ['exit-error', /authentication/],
    ['missing-final', /evento final/],
    ['mcp-denied', /recusada/],
  ] as const)('rejects %s instead of declaring success', async (mode, error) => {
    const f = runtime(mode);
    await expect(f.runtime.turn(request(f.root, 'codex'))).rejects.toThrow(error);
  });
  it('redacts the bridge credential from persisted event text and results', async () => {
    const f = runtime('leak');
    const req = {
      ...request(f.root),
      bridge: { url: 'http://127.0.0.1/mcp', token: 'sensitive-capability' },
    };
    const output = await f.runtime.turn(req);
    expect(output.text).toBe('secret: [redacted]');
    expect(JSON.stringify(req.onEvent.mock.calls)).not.toContain('sensitive-capability');
  });
  it('times out a hung process', async () => {
    const f = runtime('hang');
    await expect(f.runtime.turn({ ...request(f.root), timeoutMs: 100 })).rejects.toThrow(/Tempo limite/);
  });
  it('cancels a running process through the abort signal', async () => {
    const f = runtime('hang');
    const abort = new AbortController();
    const task = f.runtime.turn({ ...request(f.root), signal: abort.signal });
    setTimeout(() => abort.abort(), 100);
    await expect(task).rejects.toThrow(/interrompida/);
  });
});
describe('worktrees and guarded patch integration', () => {
  it('captures new files in a temporary index, applies multiple reviewed patches and blocks external edits', async () => {
    const repo = createTempRepo({ files: { 'existing.txt': 'base\n' } });
    temporary.push(repo.baseDir);
    const f = runtime();
    const base = await f.runtime.baseline(repo.root);
    expect(base).toBe(repo.head());
    const one = await f.runtime.prepare('run', 'one', repo.root, 'workspace-write', base);
    const two = await f.runtime.prepare('run', 'two', repo.root, 'workspace-write', base);
    writeFileSync(join(one.cwd, 'first.txt'), 'first\n');
    writeFileSync(join(two.cwd, 'second.txt'), 'second\n');
    const originalIndex = git(one.cwd, ['diff', '--cached']);
    const p1 = await f.runtime.patch(one.cwd, repo.head());
    const p2 = await f.runtime.patch(two.cwd, repo.head());
    expect(p1).toContain('first.txt');
    expect(git(one.cwd, ['diff', '--cached'])).toBe(originalIndex);
    const fingerprint = await f.runtime.apply(repo.root, p1);
    const nextFingerprint = await f.runtime.apply(repo.root, p2, fingerprint);
    expect(nextFingerprint).not.toBe(fingerprint);
    expect(readFileSync(join(repo.root, 'second.txt'), 'utf8').replaceAll('\r\n', '\n')).toBe('second\n');
    writeFileSync(join(repo.root, 'existing.txt'), 'user edit\n');
    await expect(f.runtime.apply(repo.root, p1, nextFingerprint)).rejects.toThrow(/alterações locais/);
    expect(repo.head()).toBe(base);
  }, 60000);
  it('blocks writing in a non-Git folder and refuses patches outside managed worktrees', async () => {
    const f = runtime();
    await expect(f.runtime.prepare('run', 'job', f.root, 'workspace-write')).rejects.toThrow(/Git/);
    await expect(f.runtime.patch(f.root, 'a'.repeat(40))).rejects.toThrow(/fora da área/);
  });
});
describe('orchestration JSON persistence', () => {
  it('round trips templates and preserves corrupt input instead of replacing it', async () => {
    const f = runtime();
    const file = join(f.root, 'state.json');
    const store = new JsonOrchestrationStore(file);
    const state = {
      schemaVersion: 1 as const,
      templates: [{ ...structuredClone(DEFAULT_TEAM), id: 'team' }],
      runs: [],
    };
    await store.save(state);
    expect(await store.load()).toEqual(state);
    writeFileSync(file, '{corrupt');
    await expect(store.load()).rejects.toThrow(/original foi preservado/);
    expect(readFileSync(file, 'utf8')).toBe('{corrupt');
  });
});
