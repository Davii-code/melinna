import { MelinnaError, defaultUserMessage } from '../errors';
import { truncate } from './git-runner';

export interface GitFailureContext {
  command: string;
  exitCode: number;
  /** O comando pode ter disparado hooks (commit, merge, push): saída sem causa conhecida vira `GIT_HOOK_FAILED`. */
  canRunHooks?: boolean;
}

/** `https://usuario:token@host` vira `https://***@host`. */
export function maskCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@');
}

const WARNING = /^(warning|hint|remote: warning):/i;
const ERROR_LINE = /^(fatal|error):/;

/** A linha que explica a falha: `fatal:`/`error:`; senão a primeira linha que não é aviso. */
export function pickErrorLine(stderr: string): string | null {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.find((l) => ERROR_LINE.test(l)) ?? lines.find((l) => !WARNING.test(l)) ?? null;
}

const LOCKED = /\.lock'?: File exists|Another git process seems to be running/i;
const AUTH =
  /Authentication failed|could not read (Username|Password)|Permission denied \((publickey|password)|terminal prompts disabled|HTTP Basic: Access denied|Invalid username or password|Host key verification failed/i;
const HOOK_NAMED = /\bhook (declined|failed|exited)|pre-receive|update hook|\(hook\)|pre-push hook/i;
const REJECTED = /\[rejected\]|\(fetch first\)|\(non-fast-forward\)|Updates were rejected/i;
const NOTHING = /nothing (added )?to commit|no changes added to commit/i;
const IDENTITY =
  /Please tell me who you are|unable to auto-detect (email address|name)|empty ident name|auto-detection is disabled/i;

/** Converte a saída de erro do git num `MelinnaError` com código, mensagem para a interface e sem credenciais. */
export function classifyGitFailure(stderr: string, ctx: GitFailureContext): MelinnaError {
  const clean = maskCredentials(stderr);
  const details = { command: ctx.command, exitCode: ctx.exitCode };
  if (LOCKED.test(clean)) return new MelinnaError('GIT_LOCKED', { details });
  if (AUTH.test(clean)) return new MelinnaError('GIT_AUTH', { details });
  if (HOOK_NAMED.test(clean)) return hookError(clean, details);
  if (REJECTED.test(clean)) return new MelinnaError('GIT_REJECTED', { details });
  if (IDENTITY.test(clean)) return new MelinnaError('GIT_IDENTITY', { details });
  if (NOTHING.test(clean)) return new MelinnaError('INPUT_INVALID', { userMessage: 'Não há alterações para commitar.' });
  const line = pickErrorLine(clean);
  if (ctx.canRunHooks && clean.trim().length > 0 && !(line && ERROR_LINE.test(line))) {
    return hookError(clean, details);
  }
  return new MelinnaError('GIT_FAILED', {
    userMessage: truncate(line ?? `${defaultUserMessage('GIT_FAILED')} (código ${ctx.exitCode})`, 500),
    details,
  });
}

function hookError(clean: string, details: { command: string; exitCode: number }): MelinnaError {
  const output = truncate(clean.trim(), 1500);
  return new MelinnaError('GIT_HOOK_FAILED', {
    userMessage: `${defaultUserMessage('GIT_HOOK_FAILED')}\n${output}`,
    details,
  });
}
