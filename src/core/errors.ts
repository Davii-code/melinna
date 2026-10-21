export type ErrorCode =
  | 'CATALOG_INVALID'
  | 'AGENT_NOT_FOUND'
  | 'EXECUTABLE_NOT_FOUND'
  | 'UNSAFE_LAUNCHER'
  | 'PROMPT_INVALID'
  | 'REPO_INVALID'
  | 'BASE_REF_NOT_FOUND'
  | 'BRANCH_INVALID'
  | 'WORKTREE_IN_USE'
  | 'WORKTREE_RESIDUE'
  | 'GIT_FAILED'
  | 'LIMIT_REACHED'
  | 'EXECUTION_RUNNING'
  | 'EXECUTION_NOT_RUNNING'
  | 'WORK_WOULD_BE_LOST'
  | 'HOST_UNAVAILABLE'
  | 'HOST_PROTOCOL'
  | 'HOST_AUTH'
  | 'HOST_VERSION'
  | 'INPUT_INVALID'
  | 'DISK_FULL'
  | 'STATE_CORRUPT'
  | 'SWITCH_UNSUPPORTED'
  | 'FILE_OUTSIDE_ROOT'
  | 'FILE_UNREADABLE'
  | 'INTERNAL';

export const ERROR_CODES: readonly ErrorCode[] = [
  'CATALOG_INVALID',
  'AGENT_NOT_FOUND',
  'EXECUTABLE_NOT_FOUND',
  'UNSAFE_LAUNCHER',
  'PROMPT_INVALID',
  'REPO_INVALID',
  'BASE_REF_NOT_FOUND',
  'BRANCH_INVALID',
  'WORKTREE_IN_USE',
  'WORKTREE_RESIDUE',
  'GIT_FAILED',
  'LIMIT_REACHED',
  'EXECUTION_RUNNING',
  'EXECUTION_NOT_RUNNING',
  'WORK_WOULD_BE_LOST',
  'HOST_UNAVAILABLE',
  'HOST_PROTOCOL',
  'HOST_AUTH',
  'HOST_VERSION',
  'INPUT_INVALID',
  'DISK_FULL',
  'STATE_CORRUPT',
  'SWITCH_UNSUPPORTED',
  'FILE_OUTSIDE_ROOT',
  'FILE_UNREADABLE',
  'INTERNAL',
];

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  CATALOG_INVALID: 'O catálogo de agentes tem uma entrada inválida.',
  AGENT_NOT_FOUND: 'Agente não encontrado no catálogo.',
  EXECUTABLE_NOT_FOUND: 'Executável do agente não encontrado.',
  UNSAFE_LAUNCHER: 'Não é possível lançar este agente com segurança.',
  PROMPT_INVALID: 'O enunciado contém caracteres não permitidos.',
  REPO_INVALID: 'A pasta escolhida não é um repositório git.',
  BASE_REF_NOT_FOUND: 'O ponto de partida não existe no repositório.',
  BRANCH_INVALID: 'Nome de branch inválido.',
  WORKTREE_IN_USE: 'O worktree está em uso por outra execução.',
  WORKTREE_RESIDUE: 'Há um resíduo de worktree no caminho desta execução.',
  GIT_FAILED: 'O comando git falhou.',
  LIMIT_REACHED: 'Limite de 12 execuções vivas atingido.',
  EXECUTION_RUNNING: 'A execução está rodando. Pare-a antes.',
  EXECUTION_NOT_RUNNING: 'A execução não está rodando.',
  WORK_WOULD_BE_LOST: 'A remoção perderia trabalho não salvo.',
  HOST_UNAVAILABLE: 'O hospedeiro de terminais não respondeu.',
  HOST_PROTOCOL: 'Falha de comunicação com o hospedeiro de terminais.',
  HOST_AUTH: 'O hospedeiro de terminais recusou a autenticação.',
  HOST_VERSION: 'O hospedeiro de terminais é de outra versão do app.',
  INPUT_INVALID: 'Valor inválido.',
  DISK_FULL: 'Disco sem espaço.',
  STATE_CORRUPT: 'O estado salvo do app está corrompido.',
  SWITCH_UNSUPPORTED: 'Este agente não permite essa troca.',
  FILE_OUTSIDE_ROOT: 'Este caminho está fora das pastas abertas no app.',
  FILE_UNREADABLE: 'Não foi possível ler este arquivo.',
  INTERNAL: 'Erro interno inesperado. Detalhes no log.',
};

export type ErrorDetails = Record<string, string | number | boolean | null>;

export interface MelinnaErrorOptions {
  userMessage?: string;
  details?: ErrorDetails;
  cause?: unknown;
}

export class MelinnaError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly details: ErrorDetails;

  constructor(code: ErrorCode, opts: MelinnaErrorOptions = {}) {
    const userMessage = opts.userMessage ?? DEFAULT_MESSAGES[code];
    super(userMessage, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'MelinnaError';
    this.code = code;
    this.userMessage = userMessage;
    this.details = opts.details ?? {};
  }
}

export function defaultUserMessage(code: ErrorCode): string {
  return DEFAULT_MESSAGES[code];
}

export function isMelinnaError(value: unknown): value is MelinnaError {
  return value instanceof MelinnaError;
}

export interface IpcError {
  code: ErrorCode;
  message: string;
  details?: ErrorDetails;
}

export function toIpcError(value: unknown): IpcError {
  if (isMelinnaError(value)) {
    const out: IpcError = { code: value.code, message: value.userMessage };
    if (Object.keys(value.details).length > 0) out.details = value.details;
    return out;
  }
  return { code: 'INTERNAL', message: DEFAULT_MESSAGES.INTERNAL };
}
