import { isBatchFile, resolveExecutable } from '../catalog/resolve-executable';
import { MelinnaError } from '../errors';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { Platform } from '../ports/platform';
import type { ProcessRunner } from '../ports/process-runner';
import { truncate } from './git-runner';

export const PR_TIMEOUT_MS = 60_000;

export interface PullRequest {
  url: string;
  /** A branch já tinha um PR aberto; nada foi criado. */
  existing: boolean;
}

export interface PullRequestDeps {
  runner: ProcessRunner;
  fs: FileSystem;
  platform: Platform;
  log: Logger;
}

const decoder = new TextDecoder();
const PR_URL = /https:\/\/[^\s"'<>]+\/pull\/\d+/;

export type PrFailure = 'not-pushed' | 'auth' | 'no-commits' | 'other';

export type PrOutcome =
  | { kind: 'created' | 'existing'; url: string }
  | { kind: 'failed'; reason: PrFailure; detail: string };

/** Lê a saída do `gh pr create`: o link do PR novo, o do que já existia, ou o motivo da falha. */
export function parsePrOutput(exitCode: number, stdout: string, stderr: string): PrOutcome {
  if (exitCode === 0) {
    const url = PR_URL.exec(stdout)?.[0];
    return url ? { kind: 'created', url } : { kind: 'failed', reason: 'other', detail: stdout.trim() };
  }
  const text = `${stderr}\n${stdout}`;
  const existing = /already exists/i.test(text) ? PR_URL.exec(text)?.[0] : undefined;
  if (existing) return { kind: 'existing', url: existing };
  const detail = stderr.trim() || stdout.trim();
  if (/gh auth login|not logged in/i.test(text)) return { kind: 'failed', reason: 'auth', detail };
  if (/must first push|--head flag/i.test(text)) return { kind: 'failed', reason: 'not-pushed', detail };
  if (/no commits between/i.test(text)) return { kind: 'failed', reason: 'no-commits', detail };
  return { kind: 'failed', reason: 'other', detail };
}

const FAILURES: Record<Exclude<PrFailure, 'other'>, string> = {
  'not-pushed': 'Faça push da branch antes de criar o pull request.',
  auth: 'O GitHub CLI não está autenticado. Rode "gh auth login" num terminal e tente de novo.',
  'no-commits': 'A branch não tem commits novos em relação à branch de destino.',
};

/** Cria o pull request da branch atual com o GitHub CLI (`gh pr create --fill`), sem perguntas. */
export class PullRequestService {
  constructor(private readonly deps: PullRequestDeps) {}

  async create(repo: string): Promise<PullRequest> {
    const { runner, fs, platform, log } = this.deps;
    const gh = await resolveExecutable('gh', platform, fs);
    if (!gh || isBatchFile(gh)) {
      throw new MelinnaError('PROGRAM_NOT_FOUND', {
        userMessage:
          'GitHub CLI (gh) não encontrado. Instale em https://cli.github.com e rode "gh auth login".',
        details: { command: 'gh' },
      });
    }
    const started = Date.now();
    let res;
    try {
      res = await runner.run(gh, ['pr', 'create', '--fill'], {
        cwd: repo,
        timeoutMs: PR_TIMEOUT_MS,
        env: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' },
      });
    } catch (cause) {
      log.error('git.pr_spawn_failed', { err: cause });
      throw new MelinnaError('GIT_FAILED', {
        userMessage: 'Não foi possível executar o GitHub CLI (gh).',
        details: { command: 'gh' },
        cause,
      });
    }
    const outcome = parsePrOutput(res.exitCode, decoder.decode(res.stdout), decoder.decode(res.stderr));
    log.info('git.pr', {
      ok: outcome.kind !== 'failed',
      outcome: outcome.kind === 'failed' ? outcome.reason : outcome.kind,
      code: res.exitCode,
      durationMs: Date.now() - started,
    });
    if (outcome.kind !== 'failed') return { url: outcome.url, existing: outcome.kind === 'existing' };
    throw new MelinnaError('GIT_FAILED', {
      userMessage:
        outcome.reason === 'other'
          ? `O gh pr create falhou: ${truncate(outcome.detail, 300) || `código ${res.exitCode}`}`
          : FAILURES[outcome.reason],
      details: { command: 'gh', exitCode: res.exitCode },
    });
  }
}
