export interface DebugState {
  stopped: boolean;
  threadId: number | null;
  frames: Record<string, unknown>[];
  scopes: Record<string, unknown>[];
  variables: Record<string, unknown>[];
}

export const EMPTY_DEBUG_STATE: Readonly<DebugState> = {
  stopped: false,
  threadId: null,
  frames: [],
  scopes: [],
  variables: [],
};

const MAX_FILES = 100;
const MAX_LINES_PER_FILE = 1000;
const MAX_LINE = 1_000_000;
const MAX_PATH = 4096;
const MAX_STORAGE_BYTES = 2 * 1024 * 1024;
const STORAGE_PREFIX = 'melinna.ide.breakpoints.v1:';

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalPath(value: string): { value: string; windows: boolean } | null {
  if (!value || value.length > MAX_PATH || /[\x00-\x1f\x7f]/.test(value)) return null;
  const slashed = value.replace(/\\/g, '/');
  const windows = /^[A-Za-z]:\//.test(slashed) || slashed.startsWith('//');
  let prefix: string;
  let rest: string;
  if (/^[A-Za-z]:\//.test(slashed)) {
    prefix = slashed.slice(0, 3);
    rest = slashed.slice(3);
  } else if (slashed.startsWith('//')) {
    prefix = '//';
    rest = slashed.slice(2);
  } else if (slashed.startsWith('/')) {
    prefix = '/';
    rest = slashed.slice(1);
  } else {
    return null;
  }

  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      if (part.toLowerCase() === '.git') return null;
      parts.push(part);
    }
  }
  return { value: prefix + parts.join('/'), windows };
}

function isInsideRoot(path: string, root: string): boolean {
  const file = canonicalPath(path);
  const base = canonicalPath(root);
  if (!file || !base || file.windows !== base.windows) return false;
  const candidate = file.windows ? file.value.toLowerCase() : file.value;
  const directory = base.windows ? base.value.toLowerCase() : base.value;
  const trimmed = directory.endsWith('/') && directory !== '/' ? directory.slice(0, -1) : directory;
  return candidate === trimmed || candidate.startsWith(trimmed === '/' ? '/' : `${trimmed}/`);
}

function cleanBreakpoints(value: unknown, root: string): Record<string, number[]> {
  const source = object(value);
  if (!source) return {};
  const result: Record<string, number[]> = {};
  const paths = Object.keys(source);
  for (const path of paths) {
    if (Object.keys(result).length >= MAX_FILES) break;
    if (!isInsideRoot(path, root) || !Array.isArray(source[path])) continue;
    const lines = [
      ...new Set(
        (source[path] as unknown[]).filter(
          (line): line is number =>
            Number.isInteger(line) && (line as number) >= 1 && (line as number) <= MAX_LINE,
        ),
      ),
    ]
      .slice(0, MAX_LINES_PER_FILE)
      .sort((a, b) => a - b);
    if (lines.length) result[path] = lines;
  }
  return result;
}

export function debugEvent(state: DebugState, message: Record<string, unknown>): DebugState {
  const event = message.event;
  if (event === 'stopped') {
    const body = object(message.body);
    const threadId = body?.threadId;
    return {
      stopped: true,
      threadId: Number.isInteger(threadId) && (threadId as number) >= 0 ? (threadId as number) : null,
      frames: [],
      scopes: [],
      variables: [],
    };
  }
  if (message.kind === 'closed' || event === 'continued' || event === 'terminated' || event === 'exited') {
    return { ...EMPTY_DEBUG_STATE, frames: [], scopes: [], variables: [] };
  }
  return state;
}

export function readBreakpoints(storage: Pick<Storage, 'getItem'>, root: string): Record<string, number[]> {
  if (!canonicalPath(root)) return {};
  try {
    const raw = storage.getItem(`${STORAGE_PREFIX}${root}`);
    if (!raw || new TextEncoder().encode(raw).length > MAX_STORAGE_BYTES) return {};
    const wrapper = object(JSON.parse(raw));
    if (!wrapper || wrapper.version !== 1) return {};
    return cleanBreakpoints(wrapper.breakpoints, root);
  } catch {
    return {};
  }
}

export function writeBreakpoints(
  storage: Pick<Storage, 'setItem'>,
  root: string,
  points: Record<string, number[]>,
): void {
  if (!canonicalPath(root)) return;
  try {
    const breakpoints = cleanBreakpoints(points, root);
    storage.setItem(`${STORAGE_PREFIX}${root}`, JSON.stringify({ version: 1, breakpoints }));
  } catch {
    // Armazenamento indisponível: os breakpoints continuam no estado da sessão atual.
  }
}
