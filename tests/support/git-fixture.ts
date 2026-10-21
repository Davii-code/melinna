import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { removeDirRecursive } from './temp-dirs';

export function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Teste',
      GIT_AUTHOR_EMAIL: 'teste@example.com',
      GIT_COMMITTER_NAME: 'Teste',
      GIT_COMMITTER_EMAIL: 'teste@example.com',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
}

export interface TempRepoOptions {
  /** Arquivos do commit inicial (caminho → conteúdo). */
  files?: Record<string, string | Uint8Array>;
  /** Gera N arquivos de texto em `gen/`. */
  generatedFiles?: number;
  /** Branches extras criadas a partir do commit inicial. */
  branches?: string[];
}

export interface TempRepo {
  root: string;
  baseDir: string;
  head(): string;
  commit(files: Record<string, string | Uint8Array>, message?: string): string;
  cleanup(): void;
}

export function writeFiles(root: string, files: Record<string, string | Uint8Array>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export function createTempRepo(opts: TempRepoOptions = {}): TempRepo {
  // `realpathSync.native` resolve o nome curto do perfil (ex.: `C:\Users\USUARI~1`): git e o app
  // devolvem sempre o caminho canônico, e as asserções comparam strings de caminho.
  const baseDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-repo-')));
  const root = join(baseDir, 'repo');
  mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Teste']);
  git(root, ['config', 'user.email', 'teste@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  const files: Record<string, string | Uint8Array> = {
    'README.md': '# repo de teste\n',
    ...(opts.files ?? {}),
  };
  for (let i = 0; i < (opts.generatedFiles ?? 0); i++) files[`gen/f${i}.txt`] = `arquivo ${i}\n`;
  writeFiles(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'inicial']);
  for (const b of opts.branches ?? []) git(root, ['branch', b]);
  return {
    root,
    baseDir,
    head: () => git(root, ['rev-parse', 'HEAD']).trim(),
    commit(more, message = 'mais') {
      writeFiles(root, more);
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', message]);
      return git(root, ['rev-parse', 'HEAD']).trim();
    },
    cleanup() {
      removeDirRecursive(baseDir);
    },
  };
}
