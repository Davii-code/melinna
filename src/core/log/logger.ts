import { isMelinnaError } from '../errors';
import type { Clock } from '../ports/clock';
import type { ErrorLogFields, LogFields, LogLevel, Logger } from '../ports/logger';

export interface LogSink {
  write(line: string): void;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Campos que nunca vão para o log: conteúdo do usuário e do PTY. */
export const FORBIDDEN_FIELDS = new Set(['prompt', 'input', 'output', 'env']);

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const out: SerializedError = { name: err.name, message: err.message };
    if (isMelinnaError(err)) out.code = err.code;
    if (err.stack) out.stack = err.stack;
    return out;
  }
  return { name: 'NonError', message: String(err) };
}

export interface CreateLoggerOptions {
  sink: LogSink;
  clock: Clock;
  component: string;
  minLevel?: LogLevel;
}

class JsonlLogger implements Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly clock: Clock,
    private readonly component: string,
    private readonly minLevel: LogLevel,
  ) {}

  debug(event: string, fields?: LogFields): void {
    this.log('debug', event, fields);
  }
  info(event: string, fields?: LogFields): void {
    this.log('info', event, fields);
  }
  warn(event: string, fields?: LogFields): void {
    this.log('warn', event, fields);
  }
  error(event: string, fields?: ErrorLogFields): void {
    this.log('error', event, fields);
  }
  child(component: string): Logger {
    return new JsonlLogger(this.sink, this.clock, component, this.minLevel);
  }

  private log(level: LogLevel, event: string, fields: ErrorLogFields | undefined): void {
    if (LEVELS[level] < LEVELS[this.minLevel]) return;
    const record: Record<string, unknown> = {
      ts: this.clock.now().toISOString(),
      level,
      component: this.component,
      event,
    };
    const dropped: string[] = [];
    for (const [k, v] of Object.entries(fields ?? {})) {
      if (FORBIDDEN_FIELDS.has(k)) {
        dropped.push(k);
        continue;
      }
      if (k === 'err') {
        record.err = serializeError(v);
        continue;
      }
      if (v !== undefined) record[k] = v;
    }
    this.sink.write(JSON.stringify(record));
    if (dropped.length > 0) {
      this.sink.write(
        JSON.stringify({
          ts: record.ts,
          level: 'warn',
          component: this.component,
          event: 'log.fields_dropped',
          fields: dropped.join(','),
        }),
      );
    }
  }
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  return new JsonlLogger(opts.sink, opts.clock, opts.component, opts.minLevel ?? 'info');
}
