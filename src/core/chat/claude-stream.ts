import type { ChatEvent } from './types';

const SUMMARY_MAX = 160;
/** Campos da entrada de uma ferramenta que dizem, em uma linha, o que ela faz. */
const SUMMARY_KEYS = ['file_path', 'path', 'command', 'pattern', 'query', 'url', 'description', 'prompt'];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function cut(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX)}…` : line;
}

function toolSummary(input: unknown): string {
  if (!isObj(input)) return '';
  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') return cut(value);
  }
  return '';
}

/**
 * Traduz uma linha do `claude -p --output-format stream-json` em eventos do chat. Linhas que não são JSON
 * ou de tipos sem interesse (resultado de ferramenta, eventos de sistema) não geram nada.
 */
export function parseClaudeLine(line: string): ChatEvent[] {
  const trimmed = line.trim();
  if (trimmed === '') return [];
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return [];
  }
  if (!isObj(json)) return [];
  const events: ChatEvent[] = [];
  if (json.type === 'system' && json.subtype === 'init' && typeof json.session_id === 'string') {
    events.push({ kind: 'session', sessionId: json.session_id });
  }
  if (json.type === 'assistant' && isObj(json.message) && Array.isArray(json.message.content)) {
    for (const part of json.message.content) {
      if (!isObj(part)) continue;
      if (part.type === 'text' && typeof part.text === 'string' && part.text !== '') {
        events.push({ kind: 'text', text: part.text });
      }
      if (part.type === 'tool_use' && typeof part.name === 'string') {
        events.push({ kind: 'tool', name: part.name, summary: toolSummary(part.input) });
      }
    }
  }
  if (json.type === 'result') {
    if (typeof json.session_id === 'string') events.push({ kind: 'session', sessionId: json.session_id });
    const failed = json.is_error === true || (typeof json.subtype === 'string' && json.subtype !== 'success');
    events.push(
      failed
        ? { kind: 'done', ok: false, error: typeof json.result === 'string' && json.result !== '' ? cut(json.result) : 'O agente terminou com erro.' }
        : { kind: 'done', ok: true },
    );
  }
  return events;
}
