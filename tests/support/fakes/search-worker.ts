import type { SearchWorkerLike, SearchWorkerMessage } from '../../../src/main/search-worker';

/** Thread de busca encenada: o teste decide quando e o que ela responde, e se foi encerrada. */
export class FakeSearchWorker implements SearchWorkerLike {
  terminated = 0;
  private readonly listeners = {
    message: [] as ((m: SearchWorkerMessage) => void)[],
    error: [] as ((e: Error) => void)[],
    exit: [] as ((c: number) => void)[],
  };

  on(event: 'message', listener: (message: SearchWorkerMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  on(event: 'message' | 'error' | 'exit', listener: never): unknown {
    (this.listeners[event] as unknown[]).push(listener);
    return this;
  }

  terminate(): Promise<number> {
    this.terminated++;
    return Promise.resolve(1);
  }

  emitMessage(m: SearchWorkerMessage): void {
    for (const fn of this.listeners.message) fn(m);
  }
  emitError(e: Error): void {
    for (const fn of this.listeners.error) fn(e);
  }
  emitExit(code: number): void {
    for (const fn of this.listeners.exit) fn(code);
  }
}
