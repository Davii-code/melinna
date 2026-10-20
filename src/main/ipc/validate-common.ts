import { MelinnaError } from '../../core/errors';
import { LIMITS } from '../../shared/ipc-contract';

export function invalid(what: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage: `Valor inválido: ${what}.` });
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown, what: string, min = 1, max: number = LIMITS.path): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw invalid(what);
  return v;
}

export function optStr(v: unknown, what: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  return str(v, what, 0, max);
}

export function id(v: unknown, what = 'identificador'): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(v)) throw invalid(what);
  return v;
}

export function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw invalid(what);
  return v;
}

export function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw invalid(what);
  return v;
}

export function oneOf<T extends string>(v: unknown, what: string, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) throw invalid(what);
  return v as T;
}

export function termSize(v: unknown): { cols: number; rows: number } {
  if (!isObj(v)) throw invalid('tamanho do terminal');
  return {
    cols: int(v.cols, 'colunas', LIMITS.cols.min, LIMITS.cols.max),
    rows: int(v.rows, 'linhas', LIMITS.rows.min, LIMITS.rows.max),
  };
}

export function noArgs(args: unknown[]): [] {
  if (args.length > 0) throw invalid('argumentos');
  return [];
}

/** Verifica que um id existe no estado; ids desconhecidos são INPUT_INVALID. */
export function existing(v: unknown, what: string, exists: (id: string) => boolean): string {
  const value = id(v, what);
  if (!exists(value)) throw new MelinnaError('INPUT_INVALID', { userMessage: `${what} não encontrado(a).` });
  return value;
}
