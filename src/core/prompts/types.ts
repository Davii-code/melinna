/** Escopo de um prompt: todos os workspaces ou um só. */
export type PromptScope = 'global' | { groupId: string };

/** Prompt como gravado em `prompts.json`; as variáveis são extraídas do texto, nunca persistidas. */
export interface StoredPrompt {
  id: string;
  name: string;
  body: string;
  scope: PromptScope;
  createdAt: string;
  updatedAt: string;
}

export interface Prompt extends StoredPrompt {
  /** Variáveis `{{nome}}` do texto, únicas, na ordem da primeira ocorrência. */
  variables: string[];
}

export interface QueueItem {
  id: string;
  /** Texto já resolvido para a sessão de destino. */
  text: string;
  enqueuedAt: string;
}

export type SendStatus = 'sent' | 'not-running' | 'not-ready' | 'not-found' | 'failed';

export interface SendResult {
  execId: string;
  status: SendStatus;
}

/** Texto a enviar: o corpo com variáveis é resolvido no núcleo, por destino. */
export interface SendInput {
  body: string;
  values: Record<string, string>;
  allowEmpty: string[];
  execIds: string[];
}

export type QueueDiscardReason = 'ended' | 'removed' | 'write-failed';

export interface QueueDiscarded {
  execId: string;
  items: number;
  reason: QueueDiscardReason;
}

/** Conteúdo de `userData/prompts.json`. */
export interface PromptsFile {
  version: 1;
  prompts: StoredPrompt[];
  queues: Record<string, QueueItem[]>;
}

export const PROMPTS_FILE_VERSION = 1;

export const PROMPT_NAME_MAX = 80;
export const PROMPT_BODY_MAX = 100_000;
export const PROMPT_VALUE_MAX = 10_000;
