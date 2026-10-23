import type { PromptLibrary } from '../../core/prompts/prompt-library';
import type { PromptQueue } from '../../core/prompts/prompt-queue';
import type { PromptSender } from '../../core/prompts/prompt-sender';
import type { QueueDiscarded } from '../../core/prompts/types';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import {
  parseExecIdArg,
  parseGroupArg,
  parseList,
  parsePromptId,
  parseQueueRemove,
  parseResolveOne,
  parseSave,
  parseSend,
} from './validate-prompts';

export interface PromptsIpcDeps {
  library: PromptLibrary;
  sender: PromptSender;
  queue: PromptQueue;
  /** Avisa a página de que itens da fila foram descartados. */
  emitQueueDiscarded: (e: QueueDiscarded) => void;
  model: WorkspaceModel;
  log: Logger;
}

/** Canais da biblioteca de prompts e do envio; o texto do prompt nunca vai para o log. */
export function registerPrompts(handle: Handle, deps: PromptsIpcDeps): void {
  const { library, sender, queue, model, log } = deps;
  const C = CHANNELS.prompts;
  const Q = CHANNELS.promptQueue;
  const groupExists = (id: string) => model.group(id) !== undefined;
  const execExists = (id: string) => model.execution(id) !== undefined;

  handle(
    C.list,
    handler(log, C.list, parseList(groupExists), (groupId) => library.list(groupId)),
  );
  handle(
    C.save,
    handler(log, C.save, parseSave(groupExists), (input) => library.save(input)),
  );
  handle(
    C.duplicate,
    handler(log, C.duplicate, parsePromptId, (id) => library.duplicate(id)),
  );
  handle(
    C.remove,
    handler(log, C.remove, parsePromptId, (id) => library.remove(id)),
  );
  handle(
    C.countForGroup,
    handler(log, C.countForGroup, parseGroupArg(groupExists), (groupId) => library.countForGroup(groupId)),
  );
  handle(
    C.preview,
    handler(log, C.preview, parseResolveOne(execExists), (input) => sender.preview(input)),
  );
  handle(
    C.send,
    handler(log, C.send, parseSend, (input) => sender.send(input)),
  );

  handle(
    Q.get,
    handler(log, Q.get, parseExecIdArg(execExists), (execId) => queue.get(execId)),
  );
  handle(
    Q.enqueue,
    handler(log, Q.enqueue, parseResolveOne(execExists), (input) => queue.enqueue(input)),
  );
  handle(
    Q.remove,
    handler(log, Q.remove, parseQueueRemove(execExists), (execId, itemId) => queue.remove(execId, itemId)),
  );
  handle(
    Q.clear,
    handler(log, Q.clear, parseExecIdArg(execExists), (execId) => queue.clear(execId)),
  );
  queue.onDiscarded(deps.emitQueueDiscarded);
}
