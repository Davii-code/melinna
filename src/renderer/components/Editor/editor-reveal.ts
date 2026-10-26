/** Pedido para mostrar uma ocorrência (resultado da busca no projeto) num arquivo, na linha e coluna. */
export interface RevealRequest {
  path: string;
  /** Linha e coluna a partir de 1. */
  line: number;
  column: number;
  length: number;
}

const pending = new Map<string, RevealRequest>();
const listeners = new Map<string, Set<(request: RevealRequest) => void>>();

/**
 * Pede para destacar a ocorrência. Com o arquivo já aberto num editor, vale na hora; senão fica guardado até
 * o editor do arquivo abrir (o arquivo é lido do disco antes de o editor existir).
 */
export function requestReveal(request: RevealRequest): void {
  const subscribers = listeners.get(request.path);
  if (subscribers !== undefined && subscribers.size > 0) {
    for (const fn of [...subscribers]) fn(request);
    return;
  }
  pending.set(request.path, request);
}

/** O editor do arquivo diz como mostrar uma ocorrência; usa o pedido que já esperava, se houver. */
export function onReveal(path: string, fn: (request: RevealRequest) => void): () => void {
  const set = listeners.get(path) ?? new Set();
  set.add(fn);
  listeners.set(path, set);
  const waiting = pending.get(path);
  if (waiting !== undefined) {
    pending.delete(path);
    fn(waiting);
  }
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(path);
  };
}
