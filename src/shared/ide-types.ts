import { MelinnaError } from '../core/errors';

export type ToolProtocol = 'lsp' | 'dap';
export interface ToolStart {
  protocol: ToolProtocol;
  root: string;
  executable: string;
  args: string[];
}
export interface ToolCall {
  sessionId: string;
  method: string;
  params: Record<string, unknown>;
}
export interface IdeEvent {
  sessionId: string;
  protocol: ToolProtocol;
  message: Record<string, unknown>;
}
export interface HttpInput {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}
export interface HttpOutput {
  status: number;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  truncated: boolean;
  binary: boolean;
}
export interface QueryOutput {
  columns: string[];
  rows: (string | number | null)[][];
  truncated: boolean;
}
export const IDE_LIMITS = {
  sessions: 4,
  pending: 128,
  message: 8 * 1024 * 1024,
  header: 8192,
  timeout: 20_000,
  text: 5 * 1024 * 1024,
} as const;
export const LSP_METHODS = new Set([
  'textDocument/completion',
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/documentSymbol',
  'workspace/symbol',
  'textDocument/rename',
  'textDocument/codeAction',
  'codeAction/resolve',
  'completionItem/resolve',
]);
export const LSP_NOTIFICATIONS = new Set([
  'textDocument/didOpen',
  'textDocument/didChange',
  'textDocument/didClose',
  'textDocument/didSave',
]);
export const DAP_METHODS = new Set([
  'launch',
  'attach',
  'setBreakpoints',
  'threads',
  'stackTrace',
  'scopes',
  'variables',
  'continue',
  'pause',
  'next',
  'stepIn',
  'stepOut',
  'disconnect',
]);
export function ideInvalid(message = 'Entrada da ferramenta inválida.'): never {
  throw new MelinnaError('INPUT_INVALID', { userMessage: message });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ideInvalid();
  return value as Record<string, unknown>;
}
export function toolString(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    return ideInvalid();
  return value;
}
export function parseToolStart(value: unknown): ToolStart {
  const v = object(value);
  if (v.protocol !== 'lsp' && v.protocol !== 'dap') return ideInvalid();
  const executable = toolString(v.executable);
  if (/\.(?:cmd|bat|sh|ps1)$/i.test(executable))
    return ideInvalid('Escolha um executável nativo ou Node com o caminho do script em argumentos.');
  if (!Array.isArray(v.args) || v.args.length > 64) return ideInvalid();
  const root = toolString(v.root);
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(root)) return ideInvalid();
  return { protocol: v.protocol, root, executable, args: v.args.map((arg) => toolString(arg)) };
}
export function parseToolCall(value: unknown, notification = false): ToolCall {
  const v = object(value);
  const sessionId = toolString(v.sessionId, 64);
  const method = toolString(v.method, 100);
  if (!(notification ? LSP_NOTIFICATIONS : new Set([...LSP_METHODS, ...DAP_METHODS])).has(method))
    return ideInvalid('Operação de ferramenta não permitida.');
  const params = object(v.params);
  if (new TextEncoder().encode(JSON.stringify(params)).length > IDE_LIMITS.text) return ideInvalid();
  return { sessionId, method, params };
}
