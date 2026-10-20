import { MelinnaError, type ErrorCode } from '../errors';

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1_048_576;
export const COLS_MIN = 20;
export const COLS_MAX = 1000;
export const ROWS_MIN = 5;
export const ROWS_MAX = 500;

export type MarkerKind = 'replay-start' | 'replay-end' | 'discarded' | 'gap' | 'separator';

export interface HostProcessInfo {
  execId: string;
  pid: number;
  alive: boolean;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  endedAt: string | null;
  totalBytes: number;
}

export interface SpawnRequest {
  execId: string;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  separator?: string;
}

// Cliente → hospedeiro
export type ClientMessage =
  | { t: 'hello'; protocolVersion: number; token: string }
  | ({ t: 'spawn'; id: number } & SpawnRequest)
  | { t: 'write'; execId: string }
  | { t: 'ack'; execId: string; offset: number }
  | { t: 'resize'; execId: string; cols: number; rows: number }
  | { t: 'kill'; id: number; execId: string; graceMs: number }
  | { t: 'attach'; id: number; execId: string; fromOffset: number }
  | { t: 'detach'; id: number; execId: string }
  | { t: 'list'; id: number }
  | { t: 'shutdown'; id: number; graceMs: number };

export interface AttachResult {
  firstAvailableOffset: number;
  totalBytes: number;
}

// Hospedeiro → cliente
export type HostMessage =
  | { t: 'welcome'; protocolVersion: number; hostPid: number }
  | { t: 'ok'; id: number; result?: unknown }
  | { t: 'error'; id?: number; execId?: string; code: ErrorCode; message: string; supported?: number }
  | { t: 'output'; execId: string; offset: number }
  | { t: 'marker'; execId: string; kind: MarkerKind; lostBytes?: number }
  | { t: 'exit'; execId: string; exitCode: number | null; signal: string | null; endedAt: string }
  | { t: 'activity'; execId: string; lastOutputAt: string }
  | { t: 'scrollback-status'; execId: string; persisting: boolean; reason?: 'DISK_FULL' | 'IO_ERROR' };

export interface Frame<H> {
  header: H;
  payload: Uint8Array;
}

function fail(reason: string): never {
  throw new MelinnaError('HOST_PROTOCOL', { details: { reason } });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function str(o: Record<string, unknown>, k: string, max = 4096): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length > max) fail(`campo ${k}`);
  return v;
}
function int(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(`campo ${k}`);
  return v;
}

/** Valida a forma de uma mensagem recebida pelo hospedeiro. Limites semânticos (ex.: cols) são checados por quem trata. */
export function parseClientMessage(raw: unknown): ClientMessage {
  if (!isObj(raw)) fail('mensagem não é objeto');
  const t = raw.t;
  switch (t) {
    case 'hello':
      return { t, protocolVersion: int(raw, 'protocolVersion'), token: str(raw, 'token', 256) };
    case 'spawn': {
      const args = raw.args;
      if (!Array.isArray(args) || args.length > 1000 || !args.every((a) => typeof a === 'string'))
        fail('campo args');
      const env = raw.env;
      if (!isObj(env) || !Object.values(env).every((v) => typeof v === 'string')) fail('campo env');
      const msg: ClientMessage = {
        t,
        id: int(raw, 'id'),
        execId: str(raw, 'execId', 128),
        file: str(raw, 'file'),
        args: args as string[],
        cwd: str(raw, 'cwd'),
        env: env as Record<string, string>,
        cols: int(raw, 'cols'),
        rows: int(raw, 'rows'),
      };
      if (raw.separator !== undefined) msg.separator = str(raw, 'separator');
      return msg;
    }
    case 'write':
      return { t, execId: str(raw, 'execId', 128) };
    case 'ack':
      return { t, execId: str(raw, 'execId', 128), offset: int(raw, 'offset') };
    case 'resize':
      return { t, execId: str(raw, 'execId', 128), cols: int(raw, 'cols'), rows: int(raw, 'rows') };
    case 'kill':
      return { t, id: int(raw, 'id'), execId: str(raw, 'execId', 128), graceMs: int(raw, 'graceMs') };
    case 'attach':
      return { t, id: int(raw, 'id'), execId: str(raw, 'execId', 128), fromOffset: int(raw, 'fromOffset') };
    case 'detach':
      return { t, id: int(raw, 'id'), execId: str(raw, 'execId', 128) };
    case 'list':
      return { t, id: int(raw, 'id') };
    case 'shutdown':
      return { t, id: int(raw, 'id'), graceMs: int(raw, 'graceMs') };
    default:
      return fail('tipo desconhecido');
  }
}

const HOST_TYPES = new Set([
  'welcome',
  'ok',
  'error',
  'output',
  'marker',
  'exit',
  'activity',
  'scrollback-status',
]);

/** Validação leve do lado do cliente: o hospedeiro é confiável depois do handshake. */
export function parseHostMessage(raw: unknown): HostMessage {
  if (!isObj(raw) || typeof raw.t !== 'string' || !HOST_TYPES.has(raw.t))
    fail('mensagem do hospedeiro inválida');
  return raw as unknown as HostMessage;
}
