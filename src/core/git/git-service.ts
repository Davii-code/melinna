import type { FileDiff } from '../api-types';
import { MelinnaError, isMelinnaError } from '../errors';
import { newId } from '../ids';
import { normalizeRepoPath, pathModule, repoIdOf } from '../paths';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import { DIFF_FLAGS, fillBinarySizes } from './diff';
import { fileAtHead, type FileAtHead } from './file-at-head';
import { parseUnifiedDiff } from './diff-parse';
import { classifyGitFailure } from './git-errors';
import { assertSafeRelPath, assertSafeRelPaths, assertSha, invalidInput } from './git-input';
import type { GitResult, GitRunner } from './git-runner';
import type { Branch, Change, Commit, Confirm, NeedsConfirm, RepoState, RepoStatus } from './git-types';
import { LOG_FORMAT, parseLog, renamedFrom } from './log-parse';
import { parseProgress } from './progress';
import type { KeyedMutex } from './repo-mutex';
import { parseStatusV2 } from './status-v2';

export interface GitServiceDeps {
  git: GitRunner;
  fs: FileSystem;
  log: Logger;
  mutex: KeyedMutex;
  clock: Clock;
  os: OsName;
  /** Pasta temporária do sistema, onde fica a mensagem do commit durante a operação; nunca o repositório. */
  tmpdir: string;
}

/** Acompanhamento de uma operação de rede: progresso para a interface e cancelamento. */
export interface GitIo {
  signal: AbortSignal;
  onProgress: (phase: string, percent?: number) => void;
}

export interface CommitInput {
  paths: string[];
  message: string;
  amend: boolean;
  confirm?: Confirm[];
}

interface ExecOptions {
  read?: boolean;
  allowFail?: boolean;
  /** O comando pode disparar hooks do git (commit, merge, push). */
  hooks?: boolean;
  env?: Record<string, string>;
  signal?: AbortSignal;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DIFF_LIMIT_BYTES = 1024 * 1024;
const MESSAGE_LIMIT = 20_000;
const LOG_PAGE = 200;
const NETWORK_TIMEOUT_MS = 10 * 60_000;
const BRANCH_RULE =
  'Nome de branch inválido: sem espaços, sem os caracteres ~ ^ : ? * [ e contrabarra, sem ".." nem "@{", sem começar com "-" e sem terminar com ".lock" ou "/".';

/** Caminhos nunca viram pathspec mágico (`:(glob)`, `*`): valem exatamente como foram escritos. */
const LITERAL_PATHSPECS = { GIT_LITERAL_PATHSPECS: '1' };

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Operações de git da interface: leituras sem efeito colateral, escritas serializadas por repositório. */
export class GitService {
  constructor(private readonly deps: GitServiceDeps) {}

  private get p(): ReturnType<typeof pathModule> {
    return pathModule(this.deps.os);
  }

  private abs(repo: string, rel: string): string {
    return this.p.join(repo, rel);
  }

  private async exec(repo: string, args: string[], o: ExecOptions = {}): Promise<GitResult> {
    const r = await this.deps.git.run(args, {
      cwd: repo,
      allowFail: true,
      env: { ...LITERAL_PATHSPECS, ...o.env },
      ...(o.read ? { read: true } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
      ...(o.onStderr ? { onStderr: o.onStderr } : {}),
      ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    });
    if (r.exitCode !== 0 && !o.allowFail) {
      const text = r.stderr.trim().length > 0 ? r.stderr : r.stdout;
      throw classifyGitFailure(text, {
        command: args[0] ?? '',
        exitCode: r.exitCode,
        ...(o.hooks ? { canRunHooks: true } : {}),
      });
    }
    return r;
  }

  /** Executa a operação medindo o tempo e registrando `git.op` (sem mensagem, caminhos nem saída de hook). */
  private async op<T>(name: string, repo: string, fn: () => Promise<T>, o: { locked: boolean }): Promise<T> {
    const repoId = repoIdOf(repo, this.deps.os);
    const run = async (): Promise<T> => {
      const started = Date.now();
      try {
        const value = await fn();
        const fields = { op: name, repoId, ok: true, durationMs: Date.now() - started };
        if (o.locked) this.deps.log.info('git.op', fields);
        else this.deps.log.debug('git.op', fields);
        return value;
      } catch (err) {
        this.deps.log.warn('git.op', {
          op: name,
          repoId,
          ok: false,
          code: isMelinnaError(err) ? err.code : 'INTERNAL',
          durationMs: Date.now() - started,
        });
        throw err;
      }
    };
    return o.locked ? this.deps.mutex.run(`git-ui:${normalizeRepoPath(repo, this.deps.os)}`, run) : run();
  }

  /** Leitura do estado do repositório, sem tocar o índice. */
  async status(repo: string): Promise<RepoStatus> {
    return this.op('status', repo, () => this.readStatus(repo), { locked: false });
  }

  private async readStatus(repo: string): Promise<RepoStatus> {
    // A primeira linha é o prefixo da pasta dentro do repositório: vazio só na raiz, onde os caminhos do status valem.
    const probe = await this.exec(
      repo,
      [
        'rev-parse',
        '--show-prefix',
        '--git-path',
        'MERGE_HEAD',
        '--git-path',
        'rebase-merge',
        '--git-path',
        'rebase-apply',
        '--git-path',
        'CHERRY_PICK_HEAD',
        '--git-path',
        'MERGE_MSG',
        '--git-path',
        'FETCH_HEAD',
      ],
      { read: true, allowFail: true },
    );
    const lines = probe.stdout.split(/\r?\n/);
    if (probe.exitCode !== 0 || (lines[0] ?? '') !== '') {
      throw new MelinnaError('REPO_INVALID', {
        userMessage: 'Esta pasta não é a raiz de um repositório git.',
      });
    }
    const [st, remotes] = await Promise.all([
      this.exec(repo, ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], {
        read: true,
      }),
      this.exec(repo, ['remote'], { read: true }),
    ]);
    const parsed = parseStatusV2(st.stdout);
    const [mergeHead, rebaseMerge, rebaseApply, cherryPick, mergeMsg, fetchHead] = lines
      .slice(1, 7)
      .map((rel) => this.p.resolve(repo, rel));
    const exists = (path: string | undefined) => (path ? this.deps.fs.exists(path) : Promise.resolve(false));
    const [isMerging, isRebasingMerge, isRebasingApply, isCherryPicking] = await Promise.all([
      exists(mergeHead),
      exists(rebaseMerge),
      exists(rebaseApply),
      exists(cherryPick),
    ]);
    let state: RepoState = 'normal';
    if (isRebasingMerge || isRebasingApply) state = 'rebasing';
    else if (isMerging) state = 'merging';
    else if (isCherryPicking) state = 'cherry-picking';
    else if (parsed.branch === null) state = 'detached';

    const remoteNames = remotes.stdout.split(/\r?\n/).filter((r) => r.length > 0);
    return {
      root: repo,
      branch: parsed.branch,
      head: parsed.head,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      state,
      mergeMessage: state === 'merging' && mergeMsg ? await this.readMergeMessage(mergeMsg) : null,
      changes: parsed.changes,
      hasRemote: remoteNames.length > 0,
      defaultRemoteBranch: await this.defaultRemoteBranch(repo, remoteNames),
      lastFetchAt: fetchHead ? await this.mtimeIso(fetchHead) : null,
    };
  }

  private async readMergeMessage(path: string): Promise<string | null> {
    try {
      const text = new TextDecoder().decode(await this.deps.fs.readFile(path));
      const lines = text.split(/\r?\n/).filter((l) => !l.startsWith('#'));
      const message = lines.join('\n').trim();
      return message.length > 0 ? message : null;
    } catch {
      return null;
    }
  }

  private async mtimeIso(path: string): Promise<string | null> {
    try {
      const st = await this.deps.fs.stat(path);
      return st.mtimeMs === undefined ? null : new Date(st.mtimeMs).toISOString();
    } catch {
      return null;
    }
  }

  /** Branch principal do remoto: `refs/remotes/<remote>/HEAD`; senão `main`; senão `master`. */
  private async defaultRemoteBranch(repo: string, remotes: string[]): Promise<string | null> {
    const remote = remotes.includes('origin') ? 'origin' : remotes[0];
    if (!remote) return null;
    const head = await this.exec(repo, ['symbolic-ref', '-q', `refs/remotes/${remote}/HEAD`], {
      read: true,
      allowFail: true,
    });
    const prefix = `refs/remotes/${remote}/`;
    const target = head.stdout.trim();
    if (head.exitCode === 0 && target.startsWith(prefix)) return target.slice(prefix.length);
    for (const name of ['main', 'master']) {
      for (const ref of [`refs/remotes/${remote}/${name}`, `refs/heads/${name}`]) {
        const r = await this.exec(repo, ['rev-parse', '--verify', '--quiet', ref], {
          read: true,
          allowFail: true,
        });
        if (r.exitCode === 0) return name;
      }
    }
    return null;
  }

  /** Diff de um arquivo com alterações, contra o último commit. */
  async diffFile(repo: string, path: string): Promise<FileDiff> {
    assertSafeRelPath(path);
    return this.op(
      'diffFile',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        const change = st.changes.find((c) => c.path === path);
        if (!change) throw invalidInput('Este arquivo não tem alterações.');
        const empty: FileDiff = { path, change: 'modified', hunks: [], lineCount: 0 };
        if (change.kind === 'conflict') return empty;
        const base = st.head === '' ? EMPTY_TREE : 'HEAD';
        if (change.kind === 'untracked') return this.untrackedDiff(repo, path);
        const r = await this.exec(
          repo,
          ['diff', ...DIFF_FLAGS, base, '--', ...unique([change.oldPath ?? path, path])],
          {
            read: true,
          },
        );
        return this.toFileDiff(repo, base, path, r, change.kind === 'added' ? 'added' : undefined);
      },
      { locked: false },
    );
  }

  private async untrackedDiff(repo: string, path: string): Promise<FileDiff> {
    const size = await this.deps.fs.stat(this.abs(repo, path)).then(
      (s) => s.size,
      () => 0,
    );
    if (size > DIFF_LIMIT_BYTES) {
      return { path, change: 'untracked', hunks: [], lineCount: 0, tooLarge: true };
    }
    const nullDevice = this.deps.os === 'win32' ? 'NUL' : '/dev/null';
    const r = await this.exec(repo, ['diff', '--no-index', ...DIFF_FLAGS, '--', nullDevice, path], {
      read: true,
      allowFail: true,
    });
    if (r.exitCode > 1) throw classifyGitFailure(r.stderr, { command: 'diff', exitCode: r.exitCode });
    return this.toFileDiff(repo, 'HEAD', path, r, 'untracked');
  }

  private async toFileDiff(
    repo: string,
    base: string,
    path: string,
    r: GitResult,
    forceChange?: FileDiff['change'],
  ): Promise<FileDiff> {
    if (r.stdoutBytes.length > DIFF_LIMIT_BYTES) {
      return { path, change: forceChange ?? 'modified', hunks: [], lineCount: 0, tooLarge: true };
    }
    const file = parseUnifiedDiff(r.stdout)[0] ?? { path, change: 'modified', hunks: [], lineCount: 0 };
    const out: FileDiff = { ...file, path, ...(forceChange ? { change: forceChange } : {}) };
    await fillBinarySizes(this.deps, repo, base, [out]);
    return out;
  }

  /** Commita só os arquivos escolhidos (com o nome antigo dos renomeados); em falha, o índice volta ao que era. */
  async commit(repo: string, input: CommitInput): Promise<{ sha: string } | NeedsConfirm> {
    const { paths, message, amend } = input;
    const confirm = input.confirm ?? [];
    assertSafeRelPaths(paths);
    if (typeof message !== 'string' || message.trim().length === 0)
      throw invalidInput('Escreva a mensagem do commit.');
    if (message.length > MESSAGE_LIMIT) throw invalidInput('A mensagem do commit é longa demais.');
    if (paths.length === 0 && !amend) throw invalidInput('Selecione ao menos um arquivo para o commit.');

    return this.op(
      'commit',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        const known = new Map(st.changes.map((c) => [c.path, c]));
        for (const path of paths) {
          if (!known.has(path)) throw invalidInput(`O arquivo ${path} não tem alterações para commitar.`);
        }
        this.assertCanCommit(st, paths, amend);
        if (amend && !confirm.includes('amend-published') && (await this.isPublished(repo))) {
          return { needsConfirm: 'amend-published', details: {} } satisfies NeedsConfirm;
        }
        const merging = st.state === 'merging';
        const targets = unique(paths.flatMap((path) => [path, known.get(path)?.oldPath ?? path]));
        const before = await this.exec(repo, ['write-tree'], { allowFail: true });
        const priorIndex = before.exitCode === 0 ? before.stdout.trim() : null;

        const file = this.p.join(this.deps.tmpdir, `melinna-commit-${newId()}.txt`);
        await this.deps.fs.writeFile(file, message.endsWith('\n') ? message : `${message}\n`, { flag: 'wx' });
        try {
          if (targets.length > 0) await this.exec(repo, ['add', '--', ...targets]);
          const args = ['commit', '--cleanup=whitespace', '-F', file];
          if (amend) args.push('--amend');
          if (!merging) args.push(...(targets.length > 0 ? ['--', ...targets] : ['--only']));
          await this.exec(repo, args, { hooks: true });
        } catch (err) {
          if (priorIndex) await this.exec(repo, ['read-tree', priorIndex], { allowFail: true });
          throw err;
        } finally {
          await this.deps.fs.rm(file, { force: true }).catch(() => undefined);
        }
        const head = await this.exec(repo, ['rev-parse', 'HEAD'], { read: true });
        return { sha: head.stdout.trim() };
      },
      { locked: true },
    );
  }

  private assertCanCommit(st: RepoStatus, paths: string[], amend: boolean): void {
    if (st.state === 'rebasing' || st.state === 'cherry-picking') {
      throw invalidInput('Conclua o rebase ou o cherry-pick fora do app antes de commitar.');
    }
    if (amend && st.head === '') throw invalidInput('Não há commit anterior para alterar.');
    if (st.state !== 'merging') return;
    if (amend) throw invalidInput('Não é possível alterar o último commit durante um merge.');
    if (st.changes.some((c) => c.kind === 'conflict')) {
      throw invalidInput('Resolva os conflitos antes de concluir o merge.');
    }
    if (st.changes.some((c) => !paths.includes(c.path))) {
      throw invalidInput('Durante um merge, todos os arquivos entram no commit.');
    }
  }

  /** O último commit já está no upstream? Sem upstream, não está publicado. */
  private async isPublished(repo: string): Promise<boolean> {
    const r = await this.exec(repo, ['merge-base', '--is-ancestor', 'HEAD', '@{u}'], {
      read: true,
      allowFail: true,
    });
    return r.exitCode === 0;
  }

  /** Descarta alterações: apaga arquivos novos e reverte os rastreados ao último commit, só depois de confirmado. */
  async discard(repo: string, paths: string[], confirm: Confirm[] = []): Promise<void | NeedsConfirm> {
    assertSafeRelPaths(paths);
    if (paths.length === 0) throw invalidInput('Selecione ao menos um arquivo para descartar.');
    return this.op(
      'discard',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        const known = new Map(st.changes.map((c) => [c.path, c]));
        const chosen: Change[] = [];
        for (const path of unique(paths)) {
          const change = known.get(path);
          if (!change) throw invalidInput(`O arquivo ${path} não tem alterações para descartar.`);
          if (change.kind === 'conflict')
            throw invalidInput('Resolva os conflitos ou aborte o merge em vez de descartar.');
          chosen.push(change);
        }
        const deletes = (c: Change) => c.kind === 'untracked' || c.kind === 'added';
        if (!confirm.includes('discard')) {
          return {
            needsConfirm: 'discard',
            details: {
              files: chosen.map((c) => ({ path: c.path, action: deletes(c) ? 'apagar' : 'reverter' })),
            },
          } satisfies NeedsConfirm;
        }
        const restore = unique(
          chosen.flatMap((c) =>
            c.kind === 'renamed' && c.oldPath ? [c.oldPath] : deletes(c) ? [] : [c.path],
          ),
        );
        const dropFromIndex = chosen.filter(
          (c) => c.indexChanged && (c.kind === 'added' || c.kind === 'renamed'),
        );
        if (dropFromIndex.length > 0) {
          await this.exec(repo, ['rm', '-q', '-f', '--cached', '--', ...dropFromIndex.map((c) => c.path)]);
        }
        if (restore.length > 0) {
          await this.exec(repo, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...restore]);
        }
        for (const c of chosen) {
          if (deletes(c) || c.kind === 'renamed') {
            await this.deps.fs.rm(this.abs(repo, c.path), { force: true });
          }
        }
        return undefined;
      },
      { locked: true },
    );
  }

  /** O pull ou o push precisa de confirmação antes de começar? Devolve o pedido ou `null`. */
  async checkPull(repo: string, confirm: Confirm[] = []): Promise<NeedsConfirm | null> {
    const st = await this.status(repo);
    this.assertCanSync(st, 'pull');
    if (st.upstream === null)
      throw invalidInput('Esta branch ainda não tem upstream. Faça o push dela primeiro.');
    if (st.changes.length > 0 && !confirm.includes('merge-dirty')) {
      return { needsConfirm: 'merge-dirty', details: { files: st.changes.map((c) => ({ path: c.path })) } };
    }
    return null;
  }

  async checkPush(repo: string, confirm: Confirm[] = []): Promise<NeedsConfirm | null> {
    const st = await this.status(repo);
    this.assertCanSync(st, 'push');
    const remote = await this.remoteOf(repo, st);
    if (st.upstream === null && !confirm.includes('set-upstream')) {
      return { needsConfirm: 'set-upstream', details: { branch: st.branch ?? '', remote } };
    }
    const target = st.upstream ? st.upstream.slice(st.upstream.indexOf('/') + 1) : st.branch;
    if (target !== null && target === st.defaultRemoteBranch && !confirm.includes('push-main')) {
      return { needsConfirm: 'push-main', details: { branch: target, remote } };
    }
    return null;
  }

  private assertCanSync(st: RepoStatus, what: 'pull' | 'push'): void {
    if (!st.hasRemote) throw invalidInput('Esta pasta não tem um remoto configurado.');
    if (st.branch === null) throw invalidInput('O HEAD está solto: troque para uma branch antes.');
    if (st.state === 'rebasing' || st.state === 'cherry-picking') {
      throw invalidInput('Conclua o rebase ou o cherry-pick fora do app antes.');
    }
    if (what === 'pull' && st.state === 'merging')
      throw invalidInput('Conclua ou aborte o merge em andamento antes.');
  }

  /** Remoto da branch atual (o do upstream) ou, sem upstream, `origin` / o primeiro remoto. */
  private async remoteOf(repo: string, st: RepoStatus): Promise<string> {
    if (st.upstream) return st.upstream.slice(0, st.upstream.indexOf('/'));
    const r = await this.exec(repo, ['remote'], { read: true });
    const remotes = r.stdout.split(/\r?\n/).filter((x) => x.length > 0);
    return remotes.includes('origin') ? 'origin' : (remotes[0] ?? 'origin');
  }

  private async network(
    name: string,
    repo: string,
    io: GitIo,
    args: string[],
    after?: (r: GitResult) => Promise<void>,
  ): Promise<GitResult> {
    io.onProgress('Iniciando');
    try {
      const r = await this.exec(repo, args, {
        hooks: name !== 'fetch',
        signal: io.signal,
        timeoutMs: NETWORK_TIMEOUT_MS,
        onStderr: (chunk) => {
          const progress = parseProgress(chunk);
          if (progress) io.onProgress(progress.phase, progress.percent);
        },
        allowFail: after !== undefined,
      });
      if (after) await after(r);
      return r;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MelinnaError('GIT_FAILED', {
          userMessage: 'Operação cancelada.',
          details: { command: name },
        });
      }
      throw err;
    }
  }

  async fetch(repo: string, io: GitIo): Promise<void> {
    await this.op('fetch', repo, () => this.network('fetch', repo, io, ['fetch', '--progress']), {
      locked: true,
    });
  }

  /** Pull com merge (`--no-rebase`); conflitos voltam como lista, não como erro. */
  async pull(repo: string, io: GitIo & { confirm?: Confirm[] }): Promise<{ conflicts: string[] }> {
    const needs = await this.checkPull(repo, io.confirm ?? []);
    if (needs) throw invalidInput('Esta operação precisa de confirmação.');
    return this.op(
      'pull',
      repo,
      async () => {
        let conflicts: string[] = [];
        await this.network(
          'pull',
          repo,
          io,
          ['pull', '--no-rebase', '--no-edit', '--progress'],
          async (r) => {
            if (r.exitCode === 0) return;
            const after = await this.readStatus(repo);
            conflicts = after.changes.filter((c) => c.kind === 'conflict').map((c) => c.path);
            if (after.state !== 'merging' || conflicts.length === 0) {
              throw classifyGitFailure(r.stderr.trim().length > 0 ? r.stderr : r.stdout, {
                command: 'pull',
                exitCode: r.exitCode,
                canRunHooks: true,
              });
            }
          },
        );
        return { conflicts };
      },
      { locked: true },
    );
  }

  async push(repo: string, io: GitIo & { confirm?: Confirm[] }): Promise<void> {
    const needs = await this.checkPush(repo, io.confirm ?? []);
    if (needs) throw invalidInput('Esta operação precisa de confirmação.');
    await this.op(
      'push',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        const args = ['push', '--progress'];
        if (st.upstream === null && st.branch !== null) {
          args.push('--set-upstream', await this.remoteOf(repo, st), st.branch);
        }
        await this.network('push', repo, io, args);
      },
      { locked: true },
    );
  }

  async branches(repo: string): Promise<Branch[]> {
    return this.op(
      'branches',
      repo,
      async () => {
        const r = await this.exec(
          repo,
          ['for-each-ref', '--format=%(refname)%1f%(HEAD)%1f%(upstream:short)', 'refs/heads', 'refs/remotes'],
          { read: true },
        );
        const out: Branch[] = [];
        for (const line of r.stdout.split(/\r?\n/)) {
          if (line.length === 0) continue;
          const [ref = '', head = '', upstream = ''] = line.split('\x1f');
          if (ref.startsWith('refs/heads/')) {
            out.push({
              name: ref.slice('refs/heads/'.length),
              kind: 'local',
              current: head === '*',
              ...(upstream ? { upstream } : {}),
            });
          } else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
            out.push({ name: ref.slice('refs/remotes/'.length), kind: 'remote', current: false });
          }
        }
        return out;
      },
      { locked: false },
    );
  }

  /** Cria a branch a partir da atual e passa a ser a atual. */
  async createBranch(repo: string, name: string): Promise<void> {
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 255 ||
      name.startsWith('-') ||
      name.includes('@{')
    ) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: BRANCH_RULE });
    }
    await this.op(
      'createBranch',
      repo,
      async () => {
        const valid = await this.exec(repo, ['check-ref-format', '--branch', name], {
          read: true,
          allowFail: true,
        });
        if (valid.exitCode !== 0) throw new MelinnaError('INPUT_INVALID', { userMessage: BRANCH_RULE });
        const exists = await this.exec(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], {
          read: true,
          allowFail: true,
        });
        if (exists.exitCode === 0) throw invalidInput(`A branch ${name} já existe.`);
        await this.exec(repo, ['checkout', '-b', name]);
      },
      { locked: true },
    );
  }

  private async requireBranch(repo: string, name: string): Promise<Branch> {
    const found = (await this.branches(repo)).find((b) => b.name === name);
    if (!found) throw invalidInput(`A branch ${name} não existe neste repositório.`);
    return found;
  }

  async checkout(repo: string, branch: string, confirm: Confirm[] = []): Promise<void | NeedsConfirm> {
    const target = await this.requireBranch(repo, branch);
    return this.op(
      'checkout',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        if (st.state === 'merging')
          throw invalidInput('Conclua ou aborte o merge em andamento antes de trocar de branch.');
        if (st.changes.length > 0 && !confirm.includes('checkout-dirty')) {
          return {
            needsConfirm: 'checkout-dirty',
            details: { files: st.changes.map((c) => ({ path: c.path })), branch },
          } satisfies NeedsConfirm;
        }
        if (target.kind === 'local') {
          await this.exec(repo, ['checkout', branch, '--']);
          return undefined;
        }
        // Branch só do remoto (`origin/feature`): cria a local de mesmo nome acompanhando a remota.
        const local = branch.slice(branch.indexOf('/') + 1);
        const has = (await this.branches(repo)).some((b) => b.kind === 'local' && b.name === local);
        await this.exec(repo, has ? ['checkout', local, '--'] : ['checkout', '--track', branch]);
        return undefined;
      },
      { locked: true },
    );
  }

  async merge(
    repo: string,
    branch: string,
    confirm: Confirm[] = [],
  ): Promise<{ conflicts: string[] } | NeedsConfirm> {
    await this.requireBranch(repo, branch);
    return this.op(
      'merge',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        if (st.state !== 'normal')
          throw invalidInput('Termine ou aborte a operação em andamento antes de mesclar.');
        if (st.changes.length > 0 && !confirm.includes('merge-dirty')) {
          return {
            needsConfirm: 'merge-dirty',
            details: { files: st.changes.map((c) => ({ path: c.path })), branch },
          } satisfies NeedsConfirm;
        }
        const r = await this.exec(repo, ['merge', '--no-edit', '--end-of-options', branch], {
          allowFail: true,
        });
        if (r.exitCode === 0) return { conflicts: [] };
        const after = await this.readStatus(repo);
        const conflicts = after.changes.filter((c) => c.kind === 'conflict').map((c) => c.path);
        if (after.state === 'merging' && conflicts.length > 0) return { conflicts };
        throw classifyGitFailure(r.stderr.trim().length > 0 ? r.stderr : r.stdout, {
          command: 'merge',
          exitCode: r.exitCode,
          canRunHooks: true,
        });
      },
      { locked: true },
    );
  }

  /** Aborta o merge em andamento, descartando as resoluções já feitas. */
  async abortMerge(repo: string, confirm: Confirm[] = []): Promise<void | NeedsConfirm> {
    return this.op(
      'abortMerge',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        if (st.state !== 'merging') throw invalidInput('Não há merge em andamento.');
        if (!confirm.includes('abort-merge'))
          return { needsConfirm: 'abort-merge', details: {} } satisfies NeedsConfirm;
        await this.exec(repo, ['merge', '--abort']);
        return undefined;
      },
      { locked: true },
    );
  }

  /** Marca arquivos em conflito como resolvidos (os coloca no índice com o conteúdo atual). */
  async markResolved(repo: string, paths: string[]): Promise<void> {
    assertSafeRelPaths(paths);
    if (paths.length === 0) throw invalidInput('Selecione ao menos um arquivo.');
    await this.op(
      'markResolved',
      repo,
      async () => {
        const st = await this.readStatus(repo);
        const known = new Set(st.changes.map((c) => c.path));
        for (const path of paths) {
          if (!known.has(path)) throw invalidInput(`O arquivo ${path} não está em conflito.`);
        }
        await this.exec(repo, ['add', '--', ...unique(paths)]);
      },
      { locked: true },
    );
  }

  /** Página de 200 commits da branch atual, a partir de `skip`. */
  async log(repo: string, skip: number): Promise<Commit[]> {
    if (!Number.isInteger(skip) || skip < 0) throw invalidInput('Posição do histórico inválida.');
    return this.op(
      'log',
      repo,
      async () => {
        const r = await this.exec(
          repo,
          [
            'log',
            '-z',
            '--name-status',
            '-M',
            `--max-count=${LOG_PAGE}`,
            `--skip=${skip}`,
            `--format=${LOG_FORMAT}`,
          ],
          { read: true, allowFail: true },
        );
        if (r.exitCode !== 0) {
          if (/does not have any commits yet|unknown revision|bad default revision/i.test(r.stderr))
            return [];
          throw classifyGitFailure(r.stderr, { command: 'log', exitCode: r.exitCode });
        }
        return parseLog(r.stdout);
      },
      { locked: false },
    );
  }

  /** O arquivo (caminho absoluto dentro da pasta) como está no último commit; só leitura. */
  fileAtHead(repo: string, path: string): Promise<FileAtHead> {
    return this.op(
      'fileAtHead',
      repo,
      () => fileAtHead({ git: this.deps.git, os: this.deps.os }, repo, path),
      {
        locked: false,
      },
    );
  }

  /** Diff de um arquivo dentro de um commit, contra o pai dele. */
  async commitDiff(repo: string, sha: string, path: string): Promise<FileDiff> {
    assertSha(sha);
    assertSafeRelPath(path);
    return this.op(
      'commitDiff',
      repo,
      async () => {
        const names = await this.exec(
          repo,
          ['diff-tree', '-r', '-M', '--root', '--no-commit-id', '--name-status', '-z', sha],
          { read: true },
        );
        const oldPath = renamedFrom(names.stdout, path);
        const r = await this.exec(
          repo,
          [
            'diff-tree',
            '-p',
            '-r',
            '-M',
            '--root',
            '--no-commit-id',
            '--no-color',
            '--no-ext-diff',
            '--unified=3',
            sha,
            '--',
            ...unique(oldPath ? [oldPath, path] : [path]),
          ],
          { read: true },
        );
        if (r.stdoutBytes.length > DIFF_LIMIT_BYTES) {
          return { path, change: 'modified', hunks: [], lineCount: 0, tooLarge: true };
        }
        const file: FileDiff = parseUnifiedDiff(r.stdout)[0] ?? {
          path,
          change: 'modified',
          hunks: [],
          lineCount: 0,
        };
        if (file.binary) {
          file.binary = {
            oldSize:
              file.change === 'added' ? null : await this.blobSize(repo, `${sha}^`, file.oldPath ?? path),
            newSize: file.change === 'deleted' ? null : await this.blobSize(repo, sha, path),
          };
        }
        return file;
      },
      { locked: false },
    );
  }

  private async blobSize(repo: string, rev: string, path: string): Promise<number | null> {
    const r = await this.exec(repo, ['cat-file', '-s', `${rev}:${path}`], { read: true, allowFail: true });
    const n = Number.parseInt(r.stdout.trim(), 10);
    return r.exitCode === 0 && Number.isFinite(n) ? n : null;
  }
}
