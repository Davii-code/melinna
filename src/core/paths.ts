import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { OsName } from './ports/platform';

export function pathModule(os: OsName): typeof posix {
  return os === 'win32' ? win32 : posix;
}

/** Normaliza um caminho absoluto: resolve, sem separador no fim; no Windows, minúsculas e barras invertidas. */
export function normalizeRepoPath(repoPath: string, os: OsName): string {
  const p = pathModule(os);
  let out = p.resolve(repoPath);
  if (out.length > 1 && (out.endsWith('/') || out.endsWith('\\')) && !/^[A-Za-z]:\\$/.test(out))
    out = out.slice(0, -1);
  return os === 'win32' ? out.toLowerCase() : out;
}

export function repoIdOf(repoPath: string, os: OsName): string {
  return createHash('sha256').update(normalizeRepoPath(repoPath, os)).digest('hex').slice(0, 16);
}

export interface AppPaths {
  userData: string;
  state: string;
  userCatalog: string;
  /** Biblioteca de prompts e filas por sessão (versão própria, separada do estado do workspace). */
  promptsFile: string;
  /** Preferências do usuário: mapa de atalhos e configuração de execução ativa (versão própria). */
  preferencesFile: string;
  hostDir: string;
  hostRegistry: string;
  hostToken: string;
  hostEndpoint: string;
  hostSocket: string;
  logsDir: string;
  mainLog: string;
  hostLog: string;
  scrollbackRoot: string;
  /** Anexos de imagem coladas, uma pasta por execução. */
  attachmentsRoot: string;
  worktreesRoot: string;
  scrollbackDir(execId: string): string;
  attachmentsDir(execId: string): string;
  attachmentFile(execId: string, fileName: string): string;
  repoWorktrees(repoId: string): string;
  worktree(repoId: string, execId: string): string;
  lease(repoId: string, execId: string): string;
  /** Verdadeiro se `candidate` está estritamente dentro da pasta de worktrees do app. */
  isInsideWorktrees(candidate: string): boolean;
}

export function makePaths(userData: string, os: OsName): AppPaths {
  const p = pathModule(os);
  const root = p.resolve(userData);
  const hostDir = p.join(root, 'host');
  const logsDir = p.join(root, 'logs');
  const worktreesRoot = p.join(root, 'worktrees');
  const scrollbackRoot = p.join(root, 'scrollback');
  const attachmentsRoot = p.join(root, 'attachments');
  const cmp = (s: string) => (os === 'win32' ? s.toLowerCase() : s);
  return {
    userData: root,
    state: p.join(root, 'state.json'),
    userCatalog: p.join(root, 'catalog.json'),
    promptsFile: p.join(root, 'prompts.json'),
    preferencesFile: p.join(root, 'preferences.json'),
    hostDir,
    hostRegistry: p.join(hostDir, 'registry.json'),
    hostToken: p.join(hostDir, 'token'),
    hostEndpoint: p.join(hostDir, 'endpoint'),
    hostSocket: p.join(hostDir, 'sock'),
    logsDir,
    mainLog: p.join(logsDir, 'main.log'),
    hostLog: p.join(logsDir, 'host.log'),
    scrollbackRoot,
    attachmentsRoot,
    worktreesRoot,
    scrollbackDir: (execId) => p.join(scrollbackRoot, execId),
    attachmentsDir: (execId) => p.join(attachmentsRoot, execId),
    attachmentFile: (execId, fileName) => p.join(attachmentsRoot, execId, fileName),
    repoWorktrees: (repoId) => p.join(worktreesRoot, repoId),
    worktree: (repoId, execId) => p.join(worktreesRoot, repoId, execId),
    lease: (repoId, execId) => p.join(worktreesRoot, repoId, `${execId}.lease`),
    isInsideWorktrees: (candidate) => {
      const rel = p.relative(cmp(worktreesRoot), cmp(p.resolve(candidate)));
      return rel !== '' && !rel.startsWith('..') && !p.isAbsolute(rel);
    },
  };
}
