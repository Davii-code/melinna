import type { ErrorCode } from '../core/errors';
import { MelinnaError } from '../core/errors';
import type { ProjectSearchQuery, ProjectSearchResult } from '../core/files/search';
import type { Clock } from '../core/ports/clock';
import type { Logger } from '../core/ports/logger';

/** O que a thread da busca devolve: o resultado, ou o erro já com a mensagem pt-BR. */
export type SearchWorkerMessage =
  { type: 'result'; result: ProjectSearchResult } | { type: 'error'; code: ErrorCode; message: string };

/** O que o gerenciador usa de um `Worker` do Node; os testes entram com uma versão sem thread. */
export interface SearchWorkerLike {
  on(event: 'message', listener: (message: SearchWorkerMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): unknown;
}

export interface ProjectSearcherDeps {
  /** Cria a thread que roda a busca com a consulta; cada busca tem a sua. */
  createWorker: (query: ProjectSearchQuery) => SearchWorkerLike;
  /** A raiz é uma das registradas do workspace? Raízes de fora são recusadas. */
  isRootAllowed: (root: string) => boolean;
  clock: Clock;
  log: Logger;
  /** Tempo máximo de uma busca; passado dele a thread é encerrada. */
  timeoutMs?: number;
}

export const SEARCH_TIMEOUT_MS = 10_000;
export const SEARCH_MAX_ROOTS = 64;

interface Running {
  cancel: () => void;
}

/**
 * Busca no projeto numa thread separada do processo principal. Uma expressão regular não é interrompível
 * dentro do JavaScript; encerrar a thread (`terminate`) é o que corta uma regex catastrófica sem travar o
 * app. Há uma busca por vez: começar outra cancela a anterior. Nada do texto buscado vai para o log.
 */
export class ProjectSearcher {
  private running: Running | undefined;

  constructor(private readonly deps: ProjectSearcherDeps) {}

  /** Cancela a busca em andamento, se houver. */
  cancel(): void {
    this.running?.cancel();
  }

  async search(query: ProjectSearchQuery): Promise<ProjectSearchResult> {
    const { createWorker, isRootAllowed, clock, log } = this.deps;
    if (query.roots.length > SEARCH_MAX_ROOTS) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Pastas demais na busca.' });
    }
    for (const root of query.roots) {
      if (!isRootAllowed(root)) {
        throw new MelinnaError('FILE_OUTSIDE_ROOT', { details: { path: root } });
      }
    }
    this.cancel();
    // Texto vazio só cancela: é como a interface interrompe a busca (Esc) sem um canal a mais.
    if (query.text === '') return { hits: [], truncated: false, scannedFiles: 0, skipped: 0 };
    const startedAt = clock.now().getTime();
    return await new Promise<ProjectSearchResult>((resolve, reject) => {
      const worker = createWorker(query);
      let done = false;
      let cancelTimer: () => void = () => undefined;
      const finish = (settle: () => void, outcome: string) => {
        if (done) return;
        done = true;
        cancelTimer();
        if (this.running === entry) this.running = undefined;
        try {
          void Promise.resolve(worker.terminate()).catch(() => undefined);
        } catch {
          // a thread já tinha terminado
        }
        log.info('files.search_end', {
          outcome,
          roots: query.roots.length,
          durationMs: clock.now().getTime() - startedAt,
        });
        settle();
      };
      const entry: Running = {
        cancel: () => finish(() => reject(new MelinnaError('SEARCH_CANCELLED')), 'cancelled'),
      };
      this.running = entry;
      cancelTimer = clock.setTimeout(
        () =>
          finish(
            () =>
              reject(
                new MelinnaError('SEARCH_TIMEOUT', {
                  userMessage: 'A busca demorou demais; simplifique a expressão.',
                }),
              ),
            'timeout',
          ),
        this.deps.timeoutMs ?? SEARCH_TIMEOUT_MS,
      );
      worker.on('message', (message) => {
        if (message.type === 'result') {
          const { result } = message;
          log.info('files.search', {
            roots: query.roots.length,
            files: result.scannedFiles,
            hits: result.hits.length,
            truncated: result.truncated,
            durationMs: clock.now().getTime() - startedAt,
          });
          finish(() => resolve(result), 'done');
        } else {
          finish(() => reject(new MelinnaError(message.code, { userMessage: message.message })), 'error');
        }
      });
      worker.on('error', (err) => {
        log.error('files.search_failed', { err });
        finish(() => reject(new MelinnaError('INTERNAL')), 'failed');
      });
      worker.on('exit', (code) => {
        if (!done) log.error('files.search_exited', { code });
        finish(() => reject(new MelinnaError('INTERNAL')), 'exited');
      });
    });
  }
}
