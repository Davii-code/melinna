import { join } from 'node:path';
import { createTempRepo, git, writeFiles, type TempRepo, type TempRepoOptions } from './git-fixture';

export interface RemoteFixture {
  /** Repositório principal, com `origin` apontando para o remoto `--bare` e `main` rastreando `origin/main`. */
  local: TempRepo;
  /** Caminho do remoto `--bare`. */
  remote: string;
  /** Segundo clone do mesmo remoto, para criar commits "de outra pessoa". */
  other: string;
  /** Commita no segundo clone e publica no remoto. */
  pushFromOther(files: Record<string, string>, message?: string): string;
  cleanup(): void;
}

/** Repositório com remoto `--bare` local e um segundo clone, tudo numa pasta temporária. */
export function createRemoteFixture(opts: TempRepoOptions = {}): RemoteFixture {
  const local = createTempRepo(opts);
  const remote = join(local.baseDir, 'remote.git');
  const other = join(local.baseDir, 'other');
  git(local.baseDir, ['init', '-q', '--bare', '-b', 'main', remote]);
  git(local.root, ['remote', 'add', 'origin', remote]);
  git(local.root, ['push', '-q', '-u', 'origin', 'main']);
  git(local.root, ['remote', 'set-head', 'origin', 'main']);
  git(local.baseDir, ['clone', '-q', remote, other]);
  git(other, ['config', 'user.name', 'Outra Pessoa']);
  git(other, ['config', 'user.email', 'outra@example.com']);
  git(other, ['config', 'commit.gpgsign', 'false']);
  return {
    local,
    remote,
    other,
    pushFromOther(files, message = 'do outro clone') {
      writeFiles(other, files);
      git(other, ['add', '-A']);
      git(other, ['commit', '-q', '-m', message]);
      git(other, ['push', '-q', 'origin', 'HEAD']);
      return git(other, ['rev-parse', 'HEAD']).trim();
    },
    cleanup: () => local.cleanup(),
  };
}
