import { useCallback, useEffect, useRef, useState } from 'react';
import type { MelinnaApi, QueueItem } from '../../shared/ipc-contract';
import { errorMessage, unwrap } from '../api';

export interface PromptQueues {
  /** Fila de cada execução que tem itens (execuções com fila vazia não constam). */
  queues: ReadonlyMap<string, readonly QueueItem[]>;
  /** Itens descartados por execução, até o aviso ser dispensado. */
  discarded: ReadonlyMap<string, number>;
  dismissDiscarded(execId: string): void;
  removeItem(execId: string, itemId: string): Promise<void>;
  clear(execId: string): Promise<void>;
}

/**
 * Filas de prompts das execuções dadas: recarrega quando a biblioteca ou as filas mudam e acumula os avisos
 * de itens descartados. Erros das ações vão para `onError`.
 */
export function usePromptQueues(
  api: MelinnaApi,
  execIds: readonly string[],
  onError: (message: string) => void = () => undefined,
): PromptQueues {
  const [queues, setQueues] = useState<ReadonlyMap<string, readonly QueueItem[]>>(new Map());
  const [discarded, setDiscarded] = useState<ReadonlyMap<string, number>>(new Map());
  const key = execIds.join(',');
  const keyRef = useRef(key);
  keyRef.current = key;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const load = useCallback(async () => {
    const started = keyRef.current;
    const ids = started === '' ? [] : started.split(',');
    const entries = await Promise.all(
      ids.map(async (id) => {
        const r = await api.prompts.queue.get(id);
        return [id, r.ok ? r.value : []] as const;
      }),
    );
    // Uma resposta atrasada de uma lista antiga de execuções não pode sobrescrever a atual.
    if (keyRef.current !== started) return;
    setQueues(new Map(entries.filter(([, items]) => items.length > 0)));
  }, [api]);

  useEffect(() => {
    let alive = true;
    const reload = () => {
      if (alive) void load();
    };
    reload();
    const offChange = api.prompts.onChange(reload);
    return () => {
      alive = false;
      offChange();
    };
  }, [api, load, key]);

  useEffect(
    () =>
      api.prompts.onQueueDiscarded((e) => {
        setDiscarded((prev) => new Map(prev).set(e.execId, (prev.get(e.execId) ?? 0) + e.items));
      }),
    [api],
  );

  const dismissDiscarded = useCallback((execId: string) => {
    setDiscarded((prev) => {
      const next = new Map(prev);
      next.delete(execId);
      return next;
    });
  }, []);

  const act = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (err) {
        errorRef.current(errorMessage(err));
      }
      await load();
    },
    [load],
  );

  const removeItem = useCallback(
    (execId: string, itemId: string) => act(() => unwrap(api.prompts.queue.remove(execId, itemId))),
    [api, act],
  );
  const clear = useCallback((execId: string) => act(() => unwrap(api.prompts.queue.clear(execId))), [api, act]);

  return { queues, discarded, dismissDiscarded, removeItem, clear };
}
