import { MelinnaError } from '../errors';
import { newId } from '../ids';
import { isLive } from '../execution/state-machine';
import type { KeyedMutex } from '../git/repo-mutex';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { WorkspaceModel } from '../workspace/workspace-model';
import type { PromptSender, ResolveInput } from './prompt-sender';
import type { PromptStore } from './prompt-store';
import type { QueueDiscardReason, QueueDiscarded, QueueItem } from './types';

export const QUEUE_MAX = 50;

export interface PromptQueueDeps {
  store: PromptStore;
  sender: PromptSender;
  model: Pick<WorkspaceModel, 'execution'>;
  clock: Clock;
  log: Logger;
  mutex: KeyedMutex;
}

/**
 * Fila de prompts por sessão, guardada no arquivo de prompts. Cada item sai da fila (e o arquivo é gravado)
 * antes de ir ao terminal: nunca é enviado duas vezes, e o que não puder ser entregue é descartado com aviso.
 * Um item por vez: depois de uma entrega, o próximo só sai na ociosidade seguinte, isto é, depois que o
 * agente ficou ocupado e voltou a ficar ocioso.
 */
export class PromptQueue {
  /** Sessões que receberam um item e ainda não ficaram ocupadas: o próximo espera a próxima ociosidade. */
  private readonly waiting = new Set<string>();
  private readonly discardListeners = new Set<(e: QueueDiscarded) => void>();

  constructor(private readonly deps: PromptQueueDeps) {}

  get(execId: string): QueueItem[] {
    return [...(this.deps.store.data().queues[execId] ?? [])];
  }

  onDiscarded(fn: (e: QueueDiscarded) => void): () => void {
    this.discardListeners.add(fn);
    return () => this.discardListeners.delete(fn);
  }

  /**
   * Resolve o texto para a sessão e o põe na fila. Sessão ociosa com fila vazia recebe na hora.
   * Sessão que não está viva recusa com EXECUTION_NOT_RUNNING.
   */
  enqueue(input: ResolveInput): Promise<QueueItem[]> {
    const { execId } = input;
    return this.deps.mutex.run(this.key(execId), async () => {
      const text = this.deps.sender.resolveFor(execId, input);
      const exec = this.deps.model.execution(execId);
      if (!exec || !isLive(exec.status)) throw new MelinnaError('EXECUTION_NOT_RUNNING');
      if (exec.status === 'idle' && this.get(execId).length === 0 && !this.waiting.has(execId)) {
        const status = await this.deps.sender.deliver(execId, text);
        if (status === 'sent') {
          this.waiting.add(execId);
          this.deps.log.info('prompts.queue', { execId, action: 'send_now', size: 0 });
          return [];
        }
        if (status === 'failed') {
          throw new MelinnaError('INTERNAL', { userMessage: 'Não foi possível enviar o prompt.' });
        }
        throw new MelinnaError('EXECUTION_NOT_RUNNING');
      }
      if (this.get(execId).length >= QUEUE_MAX) {
        throw new MelinnaError('INPUT_INVALID', {
          userMessage: `A fila desta sessão já tem ${QUEUE_MAX} itens.`,
        });
      }
      const item: QueueItem = { id: newId(), text, enqueuedAt: this.deps.clock.now().toISOString() };
      await this.deps.store.update((d) => {
        (d.queues[execId] ??= []).push(item);
      });
      this.deps.log.info('prompts.queue', { execId, action: 'enqueue', size: this.get(execId).length });
      return this.get(execId);
    });
  }

  remove(execId: string, itemId: string): Promise<QueueItem[]> {
    return this.deps.mutex.run(this.key(execId), async () => {
      if (!this.get(execId).some((i) => i.id === itemId)) return this.get(execId);
      await this.deps.store.update((d) => {
        this.setQueue(d.queues, execId, (d.queues[execId] ?? []).filter((i) => i.id !== itemId));
      });
      this.deps.log.info('prompts.queue', { execId, action: 'remove', size: this.get(execId).length });
      return this.get(execId);
    });
  }

  clear(execId: string): Promise<void> {
    return this.deps.mutex.run(this.key(execId), async () => {
      if (this.get(execId).length === 0) return;
      await this.deps.store.update((d) => {
        delete d.queues[execId];
      });
      this.deps.log.info('prompts.queue', { execId, action: 'clear', size: 0 });
    });
  }

  /** A sessão ficou ociosa depois de ocupada: envia o primeiro item. */
  async onIdle(execId: string): Promise<void> {
    await this.dispatch(execId, true);
  }

  /** A sessão ficou ocupada: a próxima ociosidade libera o próximo item. */
  onBusy(execId: string): void {
    this.waiting.delete(execId);
  }

  /** A sessão terminou ou foi removida: a fila é descartada, com aviso. */
  onEnded(execId: string, reason: Exclude<QueueDiscardReason, 'write-failed'>): Promise<void> {
    return this.deps.mutex.run(this.key(execId), async () => {
      this.waiting.delete(execId);
      await this.discard(execId, reason);
    });
  }

  /**
   * Na abertura do app: descarta as filas de execuções que não existem mais ou não estão vivas e envia o
   * primeiro item às sessões que já estão ociosas. As demais esperam a próxima ociosidade.
   */
  async resume(): Promise<void> {
    for (const execId of Object.keys(this.deps.store.data().queues)) {
      const exec = this.deps.model.execution(execId);
      if (!exec) await this.onEnded(execId, 'removed');
      else if (!isLive(exec.status)) await this.onEnded(execId, 'ended');
      else await this.dispatch(execId, false);
    }
  }

  private key(execId: string): string {
    return `prompt-queue:${execId}`;
  }

  private setQueue(queues: Record<string, QueueItem[]>, execId: string, items: QueueItem[]): void {
    if (items.length === 0) delete queues[execId];
    else queues[execId] = items;
  }

  /** Descarta a fila inteira de uma sessão (dentro do mutex da sessão). */
  private async discard(execId: string, reason: QueueDiscardReason): Promise<void> {
    const items = this.get(execId).length;
    if (items === 0) return;
    await this.deps.store.update((d) => {
      delete d.queues[execId];
    });
    this.notifyDiscarded({ execId, items, reason });
  }

  private notifyDiscarded(e: QueueDiscarded): void {
    this.deps.log.info('prompts.queue_discarded', { execId: e.execId, items: e.items });
    for (const fn of this.discardListeners) fn(e);
  }

  private dispatch(execId: string, fromTransition: boolean): Promise<void> {
    return this.deps.mutex.run(this.key(execId), async () => {
      const { store, sender, model, log } = this.deps;
      const item = this.get(execId)[0];
      const exec = model.execution(execId);
      if (!item || !exec || exec.status !== 'idle') return;
      if (fromTransition && this.waiting.has(execId)) return;
      try {
        // Sai da fila e vai para o disco antes de ir ao terminal: nunca é enviado duas vezes.
        await store.update((d) => {
          this.setQueue(d.queues, execId, (d.queues[execId] ?? []).filter((i) => i.id !== item.id));
        });
      } catch (err) {
        log.error('prompts.queue_dispatch_failed', { err, execId });
        return;
      }
      let delivered = false;
      try {
        delivered = (await sender.deliver(execId, item.text)) === 'sent';
      } catch (err) {
        log.error('prompts.queue_write_failed', { err, execId });
      }
      if (delivered) {
        this.waiting.add(execId);
        log.info('prompts.queue', { execId, action: 'dispatch', size: this.get(execId).length });
      } else {
        this.notifyDiscarded({ execId, items: 1, reason: 'write-failed' });
      }
    });
  }
}

export interface QueueSource {
  onIdle(fn: (execId: string) => void): () => void;
  onBusy(fn: (execId: string) => void): () => void;
  onEnded(fn: (execId: string, reason: 'ended' | 'removed') => void): () => void;
}

/** Liga a fila aos eventos das execuções; devolve a função que desliga. */
export function connectQueue(source: QueueSource, queue: PromptQueue, log: Logger): () => void {
  const failed = (event: string, execId: string) => (err: unknown) => log.error(event, { err, execId });
  const offs = [
    source.onIdle((execId) => void queue.onIdle(execId).catch(failed('prompts.queue_idle_failed', execId))),
    source.onBusy((execId) => queue.onBusy(execId)),
    source.onEnded(
      (execId, reason) => void queue.onEnded(execId, reason).catch(failed('prompts.queue_ended_failed', execId)),
    ),
  ];
  return () => {
    for (const off of offs) off();
  };
}
