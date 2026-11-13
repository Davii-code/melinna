/** O que acontece numa resposta do agente, na ordem em que chega. */
export type ChatEvent =
  /** Identificador da conversa no agente: a próxima mensagem continua a partir dele. */
  | { kind: 'session'; sessionId: string }
  | { kind: 'text'; text: string }
  /** O agente usou uma ferramenta; `summary` diz em uma linha o alvo (arquivo, comando…). */
  | { kind: 'tool'; name: string; summary: string }
  /** Fim da resposta. Uma resposta sempre termina com exatamente um `done`. */
  | { kind: 'done'; ok: boolean; error?: string };

export type ChatEventEnvelope = ChatEvent & { chatId: string };

export interface ChatStarted {
  chatId: string;
  /** Nome do agente que responde, para a interface. */
  agent: string;
}

export interface ChatStartInput {
  /** Pasta onde o agente trabalha: a raiz de um workspace aberto. */
  folder: string;
  /** Modo de permissão do catálogo; ausente = o padrão do agente. Modos perigosos são recusados. */
  permission?: string;
}

export const CHAT_MESSAGE_MAX = 100_000;
export const CHAT_MAX_OPEN = 4;
export const CHAT_TIMEOUT_MS = 30 * 60_000;
