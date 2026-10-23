import { MelinnaError } from '../errors';
import type { KeyedMutex } from '../git/repo-mutex';
import { writeFileAtomic } from '../persistence/atomic-file';
import type { Clock } from '../ports/clock';
import { errorCode, type FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import {
  PROMPTS_FILE_VERSION,
  type PromptScope,
  type PromptsFile,
  type QueueItem,
  type StoredPrompt,
} from './types';

export interface PromptStoreDeps {
  fs: FileSystem;
  path: string;
  clock: Clock;
  log: Logger;
  mutex: KeyedMutex;
}

const MUTEX_KEY = 'prompts';

function emptyFile(): PromptsFile {
  return { version: PROMPTS_FILE_VERSION, prompts: [], queues: {} };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseScope(v: unknown): PromptScope | null {
  if (v === 'global') return 'global';
  if (isObj(v) && typeof v.groupId === 'string' && v.groupId.length > 0) return { groupId: v.groupId };
  return null;
}

function parsePrompt(v: unknown): StoredPrompt | null {
  if (!isObj(v)) return null;
  const scope = parseScope(v.scope);
  if (
    typeof v.id !== 'string' ||
    typeof v.name !== 'string' ||
    typeof v.body !== 'string' ||
    typeof v.createdAt !== 'string' ||
    typeof v.updatedAt !== 'string' ||
    !scope
  ) {
    return null;
  }
  return { id: v.id, name: v.name, body: v.body, scope, createdAt: v.createdAt, updatedAt: v.updatedAt };
}

function parseItem(v: unknown): QueueItem | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== 'string' || typeof v.text !== 'string' || typeof v.enqueuedAt !== 'string') return null;
  return { id: v.id, text: v.text, enqueuedAt: v.enqueuedAt };
}

/** Estrutura inválida → `null` (arquivo tratado como corrompido). */
function parseFile(v: unknown): PromptsFile | null {
  if (!isObj(v) || !Array.isArray(v.prompts) || !isObj(v.queues)) return null;
  const prompts: StoredPrompt[] = [];
  for (const raw of v.prompts) {
    const p = parsePrompt(raw);
    if (!p) return null;
    prompts.push(p);
  }
  const queues: Record<string, QueueItem[]> = {};
  for (const [execId, raw] of Object.entries(v.queues)) {
    if (!Array.isArray(raw)) return null;
    const items: QueueItem[] = [];
    for (const r of raw) {
      const item = parseItem(r);
      if (!item) return null;
      items.push(item);
    }
    if (items.length > 0) queues[execId] = items;
  }
  return { version: PROMPTS_FILE_VERSION, prompts, queues };
}

/**
 * `userData/prompts.json`: biblioteca de prompts e filas por sessão. A memória é a fonte de leitura; toda
 * mudança passa por `update`, que grava de forma atômica antes de valer e serializa as gravações.
 */
export class PromptStore {
  private file: PromptsFile = emptyFile();
  private readOnly = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: PromptStoreDeps) {}

  async load(): Promise<void> {
    const { fs, path, log } = this.deps;
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(path);
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return;
      throw err;
    }
    let json: unknown = null;
    try {
      json = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      json = null;
    }
    if (isObj(json) && typeof json.version === 'number' && json.version > PROMPTS_FILE_VERSION) {
      this.readOnly = true;
      const parsed = parseFile(json);
      if (parsed) this.file = parsed;
      log.warn('prompts.newer_version', { version: json.version });
      return;
    }
    const parsed = isObj(json) && json.version === PROMPTS_FILE_VERSION ? parseFile(json) : null;
    if (!parsed) {
      await fs.rename(path, `${path}.bad`);
      log.warn('prompts.load_failed', {});
      return;
    }
    this.file = parsed;
  }

  /** Estado atual; não mutar (use `update`). */
  data(): Readonly<PromptsFile> {
    return this.file;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Aplica `fn` a uma cópia, grava e só então adota o resultado. Falha de gravação não altera a memória. */
  update(fn: (draft: PromptsFile) => void): Promise<void> {
    return this.deps.mutex.run(MUTEX_KEY, async () => {
      if (this.readOnly) {
        throw new MelinnaError('IO_ERROR', {
          userMessage:
            'A biblioteca de prompts foi gravada por uma versão mais nova do Melinna; atualize o app para editar.',
        });
      }
      const draft = structuredClone(this.file);
      fn(draft);
      try {
        await writeFileAtomic(this.deps.fs, this.deps.path, JSON.stringify(draft, null, 2));
      } catch (err) {
        this.deps.log.error('prompts.save_failed', { err });
        throw new MelinnaError(errorCode(err) === 'ENOSPC' ? 'DISK_FULL' : 'IO_ERROR', { cause: err });
      }
      this.file = draft;
      for (const l of this.listeners) l();
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
