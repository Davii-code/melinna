import type { CloseChoice } from '../shared/ipc-contract';
import type { Logger } from '../core/ports/logger';

export const STOP_ALL_GRACE_MS = 5000;

export interface CloseFlowDeps {
  liveCount: () => number;
  stopAll: (graceMs: number) => Promise<void>;
  /** Pede à página o diálogo de fechamento. */
  askPage: (info: { liveCount: number }) => void;
  /** Fecha de fato (sem perguntar de novo). */
  quit: () => void;
  log: Logger;
}

/**
 * Fechamento da janela: sem execuções vivas, fecha direto. Com vivas, pergunta à página e espera
 * "Manter rodando" (padrão), "Encerrar todos" ou "Cancelar".
 */
export class CloseFlow {
  private asking = false;
  private allowed = false;

  constructor(private readonly deps: CloseFlowDeps) {}

  /** Chamado no evento `close` da janela; devolve `true` se o fechamento pode seguir. */
  onCloseRequested(): boolean {
    if (this.allowed) return true;
    const liveCount = this.deps.liveCount();
    if (liveCount === 0) {
      this.allowed = true;
      return true;
    }
    if (!this.asking) {
      this.asking = true;
      this.deps.askPage({ liveCount });
    }
    return false;
  }

  isAsking(): boolean {
    return this.asking;
  }

  async answer(choice: CloseChoice): Promise<void> {
    if (!this.asking) return;
    this.asking = false;
    if (choice === 'cancel') return;
    if (choice === 'stop-all') {
      this.deps.log.info('app.stop_all');
      await this.deps.stopAll(STOP_ALL_GRACE_MS);
    } else {
      this.deps.log.info('app.keep_running', { liveCount: this.deps.liveCount() });
    }
    this.allowed = true;
    this.deps.quit();
  }
}
