import { isMelinnaError, MelinnaError } from '../errors';
import type { ExecutionService } from '../execution/execution-service';
import { promptBytes } from '../execution/prompt-delivery';
import { isLive } from '../execution/state-machine';
import type { KeyedMutex } from '../git/repo-mutex';
import type { Execution } from '../persistence/state-schema';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { WorkspaceModel } from '../workspace/workspace-model';
import { PROMPT_BODY_MAX, type SendInput, type SendResult, type SendStatus } from './types';
import {
  assertNoControlChars,
  normalizeNewlines,
  resolve,
  type AutoValues,
} from './variables';

export interface PromptSenderDeps {
  model: Pick<WorkspaceModel, 'execution' | 'task' | 'group'>;
  executions: Pick<ExecutionService, 'write'>;
  clock: Clock;
  log: Logger;
  mutex: KeyedMutex;
}

export type ResolveInput = Omit<SendInput, 'execIds'> & { execId: string };

const STARTING = new Set<Execution['status']>(['preparing', 'starting']);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Envia texto às sessões como digitação confirmada, resolvendo as variáveis por sessão de destino. */
export class PromptSender {
  constructor(private readonly deps: PromptSenderDeps) {}

  /** Texto final para uma sessão, sem enviar. */
  preview(input: ResolveInput): string {
    return this.resolveFor(input.execId, input);
  }

  /** Resolve as variáveis com os valores da sessão (pasta, workspace, data) e valida o resultado. */
  resolveFor(execId: string, input: Omit<SendInput, 'execIds'>): string {
    const exec = this.deps.model.execution(execId);
    if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    const body = normalizeNewlines(input.body);
    const values = Object.fromEntries(
      Object.entries(input.values).map(([k, v]) => [k, normalizeNewlines(v)] as const),
    );
    assertNoControlChars(body);
    for (const v of Object.values(values)) assertNoControlChars(v);
    const text = resolve(body, values, this.autoValues(exec), input.allowEmpty);
    assertNoControlChars(text);
    if (text.trim() === '') {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'O texto a enviar está vazio.' });
    }
    if (text.length > PROMPT_BODY_MAX) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'O prompt deve ter até 100.000 caracteres.' });
    }
    return text;
  }

  /**
   * Resolve para cada destino antes de escrever em qualquer um: variável faltando ou caractere de controle
   * bloqueia o envio inteiro. Depois escreve em cada sessão, e o resultado vem por destino.
   */
  async send(input: SendInput): Promise<SendResult[]> {
    const { model } = this.deps;
    const texts = new Map<string, string>();
    for (const execId of input.execIds) {
      if (model.execution(execId)) texts.set(execId, this.resolveFor(execId, input));
    }
    const results: SendResult[] = [];
    for (const execId of input.execIds) {
      const text = texts.get(execId);
      let status: SendStatus = 'not-found';
      if (text !== undefined) {
        try {
          status = await this.deliver(execId, text);
        } catch (err) {
          this.deps.log.error('prompts.send_failed', { err, execId });
          status = 'failed';
        }
      }
      results.push({ execId, status });
    }
    this.deps.log.info('prompts.sent', {
      targets: results.length,
      sent: results.filter((r) => r.status === 'sent').length,
    });
    return results;
  }

  /** Escreve um texto já resolvido numa sessão, revalidando-o; um envio por vez por sessão. */
  async deliver(execId: string, text: string): Promise<SendStatus> {
    assertNoControlChars(text);
    return this.deps.mutex.run(`prompt-send:${execId}`, async () => {
      const exec = this.deps.model.execution(execId);
      if (!exec) return 'not-found';
      if (STARTING.has(exec.status)) return 'not-ready';
      if (!isLive(exec.status)) return 'not-running';
      try {
        this.deps.executions.write(execId, promptBytes(text));
      } catch (err) {
        if (isMelinnaError(err) && err.code === 'EXECUTION_NOT_RUNNING') return 'not-running';
        throw err;
      }
      return 'sent';
    });
  }

  private autoValues(exec: Execution): AutoValues {
    const task = this.deps.model.task(exec.taskId);
    const group = task ? this.deps.model.group(task.groupId) : undefined;
    const now = this.deps.clock.now();
    return {
      pasta: exec.worktreePath,
      workspace: group?.name ?? '',
      data: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    };
  }
}
