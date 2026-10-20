import type { ErrorLogFields, LogFields, LogLevel, Logger } from '../../../src/core/ports/logger';

export interface LogRecord {
  level: LogLevel;
  component: string;
  event: string;
  fields: ErrorLogFields;
}

export class MemoryLogger implements Logger {
  constructor(
    readonly records: LogRecord[] = [],
    private readonly component = 'test',
  ) {}

  debug(event: string, fields: LogFields = {}): void {
    this.records.push({ level: 'debug', component: this.component, event, fields });
  }
  info(event: string, fields: LogFields = {}): void {
    this.records.push({ level: 'info', component: this.component, event, fields });
  }
  warn(event: string, fields: LogFields = {}): void {
    this.records.push({ level: 'warn', component: this.component, event, fields });
  }
  error(event: string, fields: ErrorLogFields = {}): void {
    this.records.push({ level: 'error', component: this.component, event, fields });
  }
  child(component: string): Logger {
    return new MemoryLogger(this.records, component);
  }
  events(): string[] {
    return this.records.map((r) => r.event);
  }
  text(): string {
    return JSON.stringify(this.records, (_k, v: unknown) => (v instanceof Error ? v.message : v));
  }
}
