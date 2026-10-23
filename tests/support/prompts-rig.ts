import { PromptLibrary } from '../../src/core/prompts/prompt-library';
import { connectQueue, PromptQueue } from '../../src/core/prompts/prompt-queue';
import { PromptSender } from '../../src/core/prompts/prompt-sender';
import { PromptStore } from '../../src/core/prompts/prompt-store';
import type { FakeCore } from './fake-core';

/** Biblioteca, envio e armazenamento de prompts sobre o núcleo falso. */
export async function createPromptsRig(core: FakeCore) {
  const store = new PromptStore({
    fs: core.fs,
    path: core.paths.promptsFile,
    clock: core.clock,
    log: core.log,
    mutex: core.mutex,
  });
  await store.load();
  const library = new PromptLibrary({
    store,
    groupExists: (id) => core.model.group(id) !== undefined,
    clock: core.clock,
    log: core.log,
  });
  const sender = new PromptSender({
    model: core.model,
    executions: core.executions,
    clock: core.clock,
    log: core.log,
    mutex: core.mutex,
  });
  const queue = new PromptQueue({
    store,
    sender,
    model: core.model,
    clock: core.clock,
    log: core.log,
    mutex: core.mutex,
  });
  connectQueue(core.executions, queue, core.log);
  return { store, library, sender, queue };
}
