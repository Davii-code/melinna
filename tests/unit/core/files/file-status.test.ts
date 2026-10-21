import { describe, expect, it } from 'vitest';
import { FileStatusService } from '../../../../src/core/files/file-status';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner, failed, ok } from '../../../support/fakes/process-runner';
import { currentOs } from '../../../support/os';

const ROOT = '/ws';

function setup(statusOutput: string | null) {
  const log = new MemoryLogger();
  const runner = new FakeProcessRunner().on((_file, args) => {
    if (!args.includes('status')) return undefined;
    return statusOutput === null ? failed(128, 'not a git repository') : ok(statusOutput);
  });
  const service = new FileStatusService({
    git: new GitRunner(runner, log),
    os: currentOs,
    log,
    roots: () => [{ path: ROOT, label: 'ws', kind: 'workspace' }],
  });
  return { service, runner, log };
}

describe('FileStatusService', () => {
  it('returns the per-file status of a registered root', async () => {
    const { service, runner } = setup(' M a.ts\0?? b.txt\0');
    const map = await service.status(ROOT);
    expect(map).toEqual({ 'a.ts': 'modified', 'b.txt': 'untracked' });
    // leitura: o comando não pode tocar o índice
    const args = runner.calls[0]?.args ?? [];
    expect(args).toContain('--no-optional-locks');
    expect(args).toContain('--porcelain=v1');
  });

  it('returns nothing for a folder outside the navigable roots without running git', async () => {
    const { service, runner } = setup(' M a.ts\0');
    expect(await service.status('/fora')).toEqual({});
    expect(runner.calls).toHaveLength(0);
  });

  it('returns nothing when the folder is not a repository', async () => {
    const { service } = setup(null);
    expect(await service.status(ROOT)).toEqual({});
  });
});
