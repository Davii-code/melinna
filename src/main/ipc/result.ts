import { isMelinnaError, toIpcError } from '../../core/errors';
import type { Logger } from '../../core/ports/logger';
import type { Result } from '../../shared/ipc-contract';

/** Executa um handler e devolve `Result`; nunca rejeita. Erros desconhecidos viram INTERNAL (detalhe só no log). */
export async function toResult<T>(
  log: Logger,
  channel: string,
  fn: () => Promise<T> | T,
): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    if (!isMelinnaError(err)) log.error('ipc.internal_error', { channel, err });
    const e = toIpcError(err);
    const error: Extract<Result<T>, { ok: false }>['error'] = { code: e.code, message: e.message };
    if (e.details) error.details = e.details;
    return { ok: false, error };
  }
}

/** Registra um handler de `ipcMain.handle` sem o evento: os argumentos chegam como recebidos da página. */
export type Handle = (channel: string, handler: (...args: unknown[]) => Promise<Result<unknown>>) => void;

export function handler<A extends unknown[], T>(
  log: Logger,
  channel: string,
  parse: (args: unknown[]) => A,
  fn: (...args: A) => Promise<T> | T,
): (...args: unknown[]) => Promise<Result<unknown>> {
  return (...raw: unknown[]) => toResult(log, channel, () => fn(...parse(raw)));
}
