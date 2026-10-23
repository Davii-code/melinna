import type { DiffResult, FileDiff } from '../api-types';
import { MelinnaError } from '../errors';
import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import { isDirect } from '../persistence/state-schema';
import type { WorkspaceModel } from '../workspace/workspace-model';
import { parseUnifiedDiff } from './diff-parse';
import type { GitRunner } from './git-runner';
import { repoRoot } from './repo';

export interface DiffDeps {
  git: GitRunner;
  fs: FileSystem;
  os: OsName;
  log: Logger;
}

export const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--unified=3', '-M'];

async function blobSize(git: GitRunner, cwd: string, commit: string, path: string): Promise<number | null> {
  const r = await git.run(['cat-file', '-s', `${commit}:${path}`], { cwd, read: true, allowFail: true });
  const n = Number.parseInt(r.stdout.trim(), 10);
  return r.exitCode === 0 && Number.isFinite(n) ? n : null;
}

async function fileSize(fs: FileSystem, abs: string): Promise<number | null> {
  try {
    const st = await fs.stat(abs);
    return st.isFile ? st.size : null;
  } catch {
    return null;
  }
}

/**
 * Diff do worktree contra o commit base: commits do agente, alterações em stage e fora de stage
 * (`git diff <base>`) e arquivos não rastreados (`git diff --no-index` contra o arquivo nulo).
 * Só leituras: o índice do worktree não é alterado.
 */
export async function diffWorktree(
  deps: DiffDeps,
  input: { worktreePath: string; baseCommit: string },
): Promise<DiffResult> {
  const { git, fs, os } = deps;
  const cwd = input.worktreePath;
  const tracked = await git.run(['diff', ...DIFF_FLAGS, input.baseCommit, '--'], { cwd, read: true });
  const files: FileDiff[] = parseUnifiedDiff(tracked.stdout);

  const others = await git.run(['ls-files', '--others', '--exclude-standard', '-z'], { cwd, read: true });
  const nullDevice = os === 'win32' ? 'NUL' : '/dev/null';
  for (const rel of others.stdout.split('\0').filter((x) => x.length > 0)) {
    // código 1 = há diferença; acima disso é falha
    const r = await git.run(['diff', '--no-index', ...DIFF_FLAGS, '--', nullDevice, rel], {
      cwd,
      read: true,
      allowFail: true,
    });
    if (r.exitCode > 1) {
      throw new MelinnaError('GIT_FAILED', {
        userMessage: `Não foi possível calcular o diff do arquivo não rastreado ${rel}.`,
        details: { command: 'diff', exitCode: r.exitCode },
      });
    }
    for (const f of parseUnifiedDiff(r.stdout)) files.push({ ...f, path: rel, change: 'untracked' });
  }

  await fillBinarySizes(deps, cwd, input.baseCommit, files);
  return { files };
}

/** Preenche os tamanhos antigo e novo dos arquivos binários (o diff só diz que são binários). */
export async function fillBinarySizes(
  deps: Pick<DiffDeps, 'git' | 'fs' | 'os'>,
  cwd: string,
  baseCommit: string,
  files: FileDiff[],
): Promise<void> {
  const { git, fs, os } = deps;
  const p = pathModule(os);
  for (const f of files) {
    if (!f.binary) continue;
    const oldPath = f.oldPath ?? f.path;
    f.binary = {
      oldSize:
        f.change === 'added' || f.change === 'untracked' ? null : await blobSize(git, cwd, baseCommit, oldPath),
      newSize: f.change === 'deleted' ? null : await fileSize(fs, p.join(cwd, f.path)),
    };
  }
}

/** Diff por execução, a partir do estado do workspace. */
export class DiffService {
  constructor(private readonly deps: DiffDeps & { model: WorkspaceModel }) {}

  async diff(execId: string): Promise<DiffResult> {
    const exec = this.deps.model.execution(execId);
    if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    if (!(await this.deps.fs.exists(exec.worktreePath))) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'O worktree desta execução não existe.' });
    }
    const task = this.deps.model.task(exec.taskId);
    let baseCommit = exec.baseCommit;
    if (task && isDirect(task)) {
      // Execução direta: mostra o que mudou na pasta desde o último commit; pasta fora do git não tem diff.
      const inRepo = await repoRoot(this.deps.git, exec.worktreePath, this.deps.os).then(
        () => true,
        () => false,
      );
      if (!inRepo) return { files: [] };
      baseCommit = 'HEAD';
    }
    const started = Date.now();
    const result = await diffWorktree(this.deps, { worktreePath: exec.worktreePath, baseCommit });
    this.deps.log.info('diff.computed', {
      execId,
      files: result.files.length,
      durationMs: Date.now() - started,
    });
    return result;
  }
}
