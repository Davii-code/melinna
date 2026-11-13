import type { ChatService } from '../../core/chat/chat-service';
import { CHAT_MESSAGE_MAX, type ChatStartInput } from '../../core/chat/types';
import { MelinnaError } from '../../core/errors';
import { normalizeRepoPath } from '../../core/paths';
import type { Logger } from '../../core/ports/logger';
import type { OsName } from '../../core/ports/platform';
import { CHANNELS, LIMITS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { id, invalid, isObj, str } from './validate-common';

export interface ChatIpcDeps {
  chat: Pick<ChatService, 'start' | 'send' | 'stop' | 'close'>;
  /** Raízes das pastas dos workspaces abertos: o chat só trabalha numa delas. */
  roots: () => string[];
  os: OsName;
  log: Logger;
}

const chatId = (args: unknown[]): [string] => [id(args[0], 'conversa')];

/** Canais do chat sem terminal; o texto das mensagens nunca vai para o log. */
export function registerChat(handle: Handle, deps: ChatIpcDeps): void {
  const { chat, log } = deps;
  const C = CHANNELS.chat;
  const parseStart = (args: unknown[]): [ChatStartInput] => {
    const v = args[0];
    if (!isObj(v)) throw invalid('conversa');
    const folder = str(v.folder, 'pasta', 1, LIMITS.path);
    const wanted = normalizeRepoPath(folder, deps.os);
    if (!deps.roots().some((root) => normalizeRepoPath(root, deps.os) === wanted)) {
      throw new MelinnaError('FILE_OUTSIDE_ROOT');
    }
    const input: ChatStartInput = { folder };
    if (v.permission !== undefined) input.permission = str(v.permission, 'modo de permissão', 1, 64);
    return [input];
  };
  handle(
    C.start,
    handler(log, C.start, parseStart, (input) => chat.start(input)),
  );
  handle(
    C.send,
    handler(
      log,
      C.send,
      (args: unknown[]): [string, string] => [id(args[0], 'conversa'), str(args[1], 'mensagem', 1, CHAT_MESSAGE_MAX)],
      (conversation, text) => chat.send(conversation, text),
    ),
  );
  handle(
    C.stop,
    handler(log, C.stop, chatId, (conversation) => chat.stop(conversation)),
  );
  handle(
    C.close,
    handler(log, C.close, chatId, (conversation) => chat.close(conversation)),
  );
}
