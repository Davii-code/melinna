import type { ChatLaunch } from '../catalog/catalog-service';
import { MelinnaError } from '../errors';
import { truncate } from '../git/git-runner';
import { newId } from '../ids';
import type { Logger } from '../ports/logger';
import type { ProcessRunner } from '../ports/process-runner';
import { parseClaudeLine } from './claude-stream';
import {
  CHAT_MAX_OPEN,
  CHAT_MESSAGE_MAX,
  CHAT_TIMEOUT_MS,
  type ChatEvent,
  type ChatEventEnvelope,
  type ChatStarted,
  type ChatStartInput,
} from './types';

export interface ChatServiceDeps {
  catalog: { chatLaunch(permission?: string): Promise<ChatLaunch | null> };
  runner: ProcessRunner;
  log: Logger;
  emit: (event: ChatEventEnvelope) => void;
  newId?: () => string;
}

interface Chat {
  folder: string;
  launch: ChatLaunch;
  /** Conversa no agente; `null` até a primeira resposta. */
  sessionId: string | null;
  running: AbortController | null;
}

/** Caracteres de controle exceto quebra de linha e tabulação. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function invalid(message: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage: message });
}

/**
 * Chat sem terminal: cada mensagem roda o agente em modo não interativo na pasta do workspace, com a
 * saída em eventos (texto, uso de ferramenta, fim). A conversa continua pelo identificador de sessão do
 * próprio agente; o app não guarda o histórico.
 */
export class ChatService {
  private readonly chats = new Map<string, Chat>();

  constructor(private readonly deps: ChatServiceDeps) {}

  async start(input: ChatStartInput): Promise<ChatStarted> {
    if (this.chats.size >= CHAT_MAX_OPEN) {
      throw new MelinnaError('LIMIT_REACHED', {
        userMessage: `Há um limite de ${CHAT_MAX_OPEN} conversas abertas. Feche uma antes.`,
      });
    }
    const launch = await this.deps.catalog.chatLaunch(input.permission);
    if (!launch) {
      throw new MelinnaError('PROGRAM_NOT_FOUND', {
        userMessage: 'Nenhum agente instalado tem modo de chat. Instale o Claude Code.',
      });
    }
    const chatId = (this.deps.newId ?? newId)();
    this.chats.set(chatId, { folder: input.folder, launch, sessionId: null, running: null });
    this.deps.log.info('chat.started', { chatId, agentId: launch.agent.id });
    return { chatId, agent: launch.agent.displayName };
  }

  /** Envia uma mensagem; a resposta chega por eventos e termina com `done`. Uma mensagem por vez. */
  send(chatId: string, text: string): void {
    const chat = this.chats.get(chatId);
    if (!chat) throw invalid('Conversa não encontrada.');
    if (chat.running) throw invalid('O agente ainda está respondendo.');
    const message = text.replace(/\r\n/g, '\n');
    if (message.trim() === '') throw invalid('Escreva a mensagem.');
    if (message.length > CHAT_MESSAGE_MAX) throw invalid('A mensagem deve ter até 100.000 caracteres.');
    if (CONTROL.test(message)) throw invalid('A mensagem contém caracteres de controle; remova-os.');
    const controller = new AbortController();
    chat.running = controller;
    void this.run(chatId, chat, message, controller);
  }

  /** Interrompe a resposta em curso; sem resposta em curso, não faz nada. */
  stop(chatId: string): void {
    this.chats.get(chatId)?.running?.abort();
  }

  /** Encerra a conversa e a resposta em curso; fechar de novo não faz nada. */
  close(chatId: string): void {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    chat.running?.abort();
    this.chats.delete(chatId);
    this.deps.log.info('chat.closed', { chatId });
  }

  closeAll(): void {
    for (const chatId of [...this.chats.keys()]) this.close(chatId);
  }

  private async run(chatId: string, chat: Chat, message: string, controller: AbortController): Promise<void> {
    const { runner, log, emit } = this.deps;
    const args = chat.sessionId
      ? [...chat.launch.args, ...chat.launch.resumeArgs, chat.sessionId]
      : chat.launch.args;
    let pending = '';
    let finished = false;
    const publish = (event: ChatEvent) => {
      // Depois de fechada, a conversa não publica mais nada.
      if (this.chats.get(chatId) !== chat) return;
      if (event.kind === 'session') chat.sessionId = event.sessionId;
      if (event.kind === 'done') {
        if (finished) return;
        finished = true;
      }
      emit({ ...event, chatId });
    };
    const consume = (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) for (const event of parseClaudeLine(line)) publish(event);
    };
    const started = Date.now();
    try {
      const res = await runner.run(chat.launch.file, args, {
        cwd: chat.folder,
        timeoutMs: CHAT_TIMEOUT_MS,
        stdin: encoder.encode(message),
        signal: controller.signal,
        onStdout: consume,
      });
      consume('\n');
      log.info('chat.turn', { chatId, code: res.exitCode, durationMs: Date.now() - started });
      if (res.exitCode !== 0) {
        const reason = truncate(decoder.decode(res.stderr).trim(), 300) || `código ${res.exitCode}`;
        publish({ kind: 'done', ok: false, error: `${chat.launch.agent.displayName} falhou: ${reason}` });
      } else {
        publish({ kind: 'done', ok: false, error: 'O agente terminou sem responder.' });
      }
    } catch (cause) {
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      const timedOut = (cause as { code?: unknown } | null)?.code === 'ETIMEDOUT';
      if (!aborted) log.error('chat.turn_failed', { err: cause, chatId, timedOut });
      publish({
        kind: 'done',
        ok: false,
        error: aborted
          ? 'Resposta interrompida.'
          : timedOut
            ? 'O agente demorou demais para responder.'
            : `Não foi possível executar ${chat.launch.agent.displayName}.`,
      });
    } finally {
      if (chat.running === controller) chat.running = null;
    }
  }
}
