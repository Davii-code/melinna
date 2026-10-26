import { MelinnaError } from '../errors';
import { looksBinary, isInsideRoot } from '../files/tree';
import { pathModule } from '../paths';
import type { OsName } from '../ports/platform';
import type { GitRunner } from './git-runner';

import type { FileAtHead } from './file-at-head-types';

export type { FileAtHead };

export const FILE_AT_HEAD_MAX_BYTES = 2 * 1024 * 1024;

const MISSING: FileAtHead = { missing: true };

export interface FileAtHeadDeps {
  git: GitRunner;
  os: OsName;
}

/**
 * Lê o arquivo como está em `HEAD`, só leitura (`--no-optional-locks`). O caminho vai ao git relativo à raiz
 * do repositório que contém a pasta (que pode ser outra que a pasta do workspace), com `/`. Fora de git, sem
 * commit, não rastreado, binário ou acima de 2 MB: `missing`, sem erro. Fora da pasta: `FILE_OUTSIDE_ROOT`.
 */
export async function fileAtHead(deps: FileAtHeadDeps, folder: string, path: string): Promise<FileAtHead> {
  const p = pathModule(deps.os);
  if (!p.isAbsolute(path) || !isInsideRoot(folder, path, deps.os)) {
    throw new MelinnaError('FILE_OUTSIDE_ROOT', { details: { path } });
  }
  const top = await deps.git.run(['rev-parse', '--show-toplevel'], {
    cwd: folder,
    read: true,
    allowFail: true,
  });
  if (top.exitCode !== 0) return MISSING;
  const root = top.stdout.trim();
  if (root === '') return MISSING;
  const rel = p
    .relative(p.resolve(root), p.resolve(path))
    .split(/[\\/]+/)
    .join('/');
  if (rel === '' || rel === '..' || rel.startsWith('../') || p.isAbsolute(rel)) {
    throw new MelinnaError('FILE_OUTSIDE_ROOT', { details: { path } });
  }
  const size = await deps.git.run(['cat-file', '-s', `HEAD:${rel}`], {
    cwd: root,
    read: true,
    allowFail: true,
  });
  const bytes = Number.parseInt(size.stdout.trim(), 10);
  if (size.exitCode !== 0 || !Number.isFinite(bytes) || bytes > FILE_AT_HEAD_MAX_BYTES) return MISSING;
  const blob = await deps.git.run(['cat-file', 'blob', `HEAD:${rel}`], {
    cwd: root,
    read: true,
    allowFail: true,
  });
  if (blob.exitCode !== 0 || looksBinary(blob.stdoutBytes)) return MISSING;
  return { text: new TextDecoder().decode(blob.stdoutBytes) };
}
