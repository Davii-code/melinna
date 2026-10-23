import { mkdtempSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeClock } from '../../src/adapters/node-clock';
import { NodeFileSystem } from '../../src/adapters/node-fs';
import { NodeProcessRunner } from '../../src/adapters/node-process-runner';
import { GitRunner } from '../../src/core/git/git-runner';
import { GitService } from '../../src/core/git/git-service';
import { KeyedMutex } from '../../src/core/git/repo-mutex';
import type { ProcessRunner } from '../../src/core/ports/process-runner';
import { MemoryLogger } from './fakes/logger';
import { removeDirRecursive } from './temp-dirs';
import { currentOs } from './os';

export interface GitServiceRig {
  service: GitService;
  log: MemoryLogger;
  /** Pasta temporária onde o serviço grava a mensagem de commit. */
  tmp: string;
  /** Arquivos que sobraram na pasta temporária. */
  leftovers(): string[];
  cleanup(): void;
}

/** Serviço de git de verdade (processos reais), com `env` extra opcional para todas as chamadas. */
export function makeGitService(opts: { env?: Record<string, string> } = {}): GitServiceRig {
  const log = new MemoryLogger();
  const base = new NodeProcessRunner();
  const extra = opts.env;
  const runner: ProcessRunner = extra
    ? { run: (file, args, o) => base.run(file, args, { ...o, env: { ...extra, ...o.env } }) }
    : base;
  const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-gitui-')));
  const service = new GitService({
    git: new GitRunner(runner, log.child('git')),
    fs: new NodeFileSystem(),
    log: log.child('git-ui'),
    mutex: new KeyedMutex(),
    clock: new NodeClock(),
    os: currentOs,
    tmpdir: tmp,
  });
  return {
    service,
    log,
    tmp,
    leftovers: () => readdirSync(tmp),
    cleanup: () => removeDirRecursive(tmp),
  };
}
