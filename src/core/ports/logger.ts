export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;
/** Campos de `error`: os mesmos de LogFields mais `err`, serializado com nome, mensagem e pilha. */
export type ErrorLogFields = { [key: string]: LogValue | unknown; err?: unknown };

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: ErrorLogFields): void;
  child(component: string): Logger;
}
