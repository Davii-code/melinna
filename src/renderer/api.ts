import { createContext, useContext } from 'react';
import type { MelinnaApi, Result, ResultError } from '../shared/ipc-contract';

export class UiError extends Error {
  constructor(readonly error: ResultError) {
    super(error.message);
  }
}

/** Devolve o valor ou lança `UiError` com a mensagem pt-BR vinda do principal. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new UiError(r.error);
  return r.value;
}

export function errorMessage(err: unknown): string {
  if (err instanceof UiError) return err.error.message;
  return 'Erro inesperado na interface.';
}

export const ApiContext = createContext<MelinnaApi | null>(null);

export function useApi(): MelinnaApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('ApiContext ausente');
  return api;
}
