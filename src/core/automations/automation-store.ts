import { MelinnaError } from '../errors';
import type { KeyedMutex } from '../git/repo-mutex';
import { newId } from '../ids';
import { writeFileAtomic } from '../persistence/atomic-file';
import type { Clock } from '../ports/clock';
import { errorCode, type FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import { parseSchedule } from './schedule';
import {
  AUTOMATION_FOLDER_MAX,
  AUTOMATION_NAME_MAX,
  AUTOMATION_PROMPT_MAX,
  AUTOMATIONS_FILE_VERSION,
  AUTOMATIONS_MAX,
  type Automation,
  type AutomationInput,
  type AutomationRun,
  type AutomationsFile,
} from './types';

export interface AutomationStoreDeps {
  fs: FileSystem;
  path: string;
  clock: Clock;
  log: Logger;
  mutex: KeyedMutex;
  newId?: () => string;
}

const MUTEX_KEY = 'automations';
const ID = /^[A-Za-z0-9-]{1,64}$/;
const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Caracteres de controle exceto quebra de linha e tabulação: o enunciado vai a um terminal. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;
const RUN_STATUS = new Set(['launched', 'failed', 'missed']);

function invalid(message: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage: message });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function text(v: unknown, what: string, min: number, max: number): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) throw invalid(`${what} inválido(a).`);
  return v;
}

/** Valida os campos que a interface envia; a pasta só é conferida no disparo (ela pode voltar a existir). */
export function parseAutomationInput(v: unknown): AutomationInput {
  if (!isObj(v)) throw invalid('Automação inválida.');
  const name = text(v.name, 'Nome', 1, AUTOMATION_NAME_MAX).trim();
  if (name === '') throw invalid('Dê um nome à automação.');
  const folder = text(v.folder, 'Pasta', 1, AUTOMATION_FOLDER_MAX).trim();
  if (folder === '') throw invalid('Escolha a pasta da automação.');
  if (typeof v.agentId !== 'string' || !AGENT_ID.test(v.agentId)) throw invalid('Agente inválido.');
  const prompt = text(v.prompt, 'Enunciado', 1, AUTOMATION_PROMPT_MAX).replace(/\r\n/g, '\n');
  if (prompt.trim() === '') throw invalid('Escreva o enunciado da automação.');
  if (CONTROL.test(prompt)) throw invalid('O enunciado contém caracteres de controle; remova-os.');
  if (typeof v.enabled !== 'boolean') throw invalid('Estado da automação inválido.');
  if (v.isolation !== 'direct' && v.isolation !== 'worktree') throw invalid('Isolamento inválido.');
  const input: AutomationInput = {
    name,
    folder,
    agentId: v.agentId,
    prompt,
    schedule: parseSchedule(v.schedule),
    enabled: v.enabled,
    isolation: v.isolation,
  };
  if (v.id !== undefined) {
    if (typeof v.id !== 'string' || !ID.test(v.id)) throw invalid('Automação não encontrada.');
    input.id = v.id;
  }
  return input;
}

function parseRun(v: unknown): AutomationRun | null {
  if (!isObj(v) || typeof v.at !== 'string' || typeof v.status !== 'string' || !RUN_STATUS.has(v.status)) {
    return null;
  }
  const run: AutomationRun = { at: v.at, status: v.status as AutomationRun['status'] };
  if (typeof v.detail === 'string') run.detail = v.detail;
  if (typeof v.taskId === 'string') run.taskId = v.taskId;
  return run;
}

/** Lê uma automação gravada; `null` descarta a entrada inválida sem derrubar as outras. */
function parseStored(v: unknown): Automation | null {
  if (!isObj(v) || typeof v.id !== 'string' || !ID.test(v.id) || typeof v.createdAt !== 'string') return null;
  try {
    const input = parseAutomationInput({ ...v, id: v.id });
    const lastRun = parseRun(v.lastRun);
    const runs = Array.isArray(v.runs)
      ? v.runs.map(parseRun).filter((run): run is AutomationRun => run !== null)
      : lastRun
        ? [lastRun]
        : [];
    return { ...input, id: v.id, createdAt: v.createdAt, lastRun, runs };
  } catch {
    return null;
  }
}

/**
 * `userData/automations.json`: as automações agendadas e o resultado do último disparo de cada uma. A
 * memória é a fonte de leitura; cada mudança grava de forma atômica antes de valer. Arquivo de versão
 * mais nova é só leitura; entradas inválidas são ignoradas.
 */
export class AutomationStore {
  private file: AutomationsFile = { version: AUTOMATIONS_FILE_VERSION, automations: [] };
  private readOnly = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: AutomationStoreDeps) {}

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
    if (!isObj(json) || typeof json.version !== 'number' || !Array.isArray(json.automations)) {
      log.warn('automations.load_failed', {});
      return;
    }
    if (json.version > AUTOMATIONS_FILE_VERSION) {
      this.readOnly = true;
      log.warn('automations.newer_version', { version: json.version });
    }
    const automations = json.automations.map(parseStored).filter((a): a is Automation => a !== null);
    if (automations.length !== json.automations.length) {
      log.warn('automations.entries_dropped', { dropped: json.automations.length - automations.length });
    }
    this.file = { version: AUTOMATIONS_FILE_VERSION, automations: automations.slice(0, AUTOMATIONS_MAX) };
  }

  list(): Automation[] {
    return structuredClone(this.file.automations);
  }

  get(id: string): Automation | undefined {
    const found = this.file.automations.find((a) => a.id === id);
    return found ? structuredClone(found) : undefined;
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Cria (sem `id`) ou edita. Mudar o agendamento zera o último disparo: a contagem recomeça agora. */
  async save(raw: unknown): Promise<Automation> {
    const input = parseAutomationInput(raw);
    let saved: Automation | undefined;
    await this.update((draft) => {
      if (input.id === undefined) {
        if (draft.automations.length >= AUTOMATIONS_MAX) {
          throw invalid(`O limite é de ${AUTOMATIONS_MAX} automações.`);
        }
        saved = {
          ...input,
          id: (this.deps.newId ?? newId)(),
          createdAt: this.deps.clock.now().toISOString(),
          lastRun: null,
        };
        draft.automations.push(saved);
        return;
      }
      const index = draft.automations.findIndex((a) => a.id === input.id);
      const current = draft.automations[index];
      if (!current) throw invalid('Automação não encontrada.');
      const sameSchedule = JSON.stringify(current.schedule) === JSON.stringify(input.schedule);
      saved = {
        ...input,
        id: current.id,
        createdAt: sameSchedule ? current.createdAt : this.deps.clock.now().toISOString(),
        lastRun: sameSchedule ? current.lastRun : null,
        runs: current.runs ?? [],
      };
      draft.automations[index] = saved;
    });
    return structuredClone(saved!);
  }

  async remove(id: string): Promise<void> {
    await this.update((draft) => {
      const index = draft.automations.findIndex((a) => a.id === id);
      if (index < 0) throw invalid('Automação não encontrada.');
      draft.automations.splice(index, 1);
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.update((draft) => {
      const found = draft.automations.find((a) => a.id === id);
      if (!found) throw invalid('Automação não encontrada.');
      found.enabled = enabled;
    });
  }

  /** Registra o resultado de um disparo; automação removida no meio do caminho é ignorada. */
  async recordRun(id: string, run: AutomationRun): Promise<void> {
    await this.update((draft) => {
      const found = draft.automations.find((a) => a.id === id);
      if (found) {
        found.runs = [...(found.runs ?? (found.lastRun ? [found.lastRun] : [])), run];
        found.lastRun = run;
      }
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private update(fn: (draft: AutomationsFile) => void): Promise<void> {
    return this.deps.mutex.run(MUTEX_KEY, async () => {
      const draft = structuredClone(this.file);
      fn(draft);
      if (!this.readOnly) {
        try {
          await writeFileAtomic(this.deps.fs, this.deps.path, JSON.stringify(draft, null, 2));
        } catch (err) {
          this.deps.log.error('automations.save_failed', { err });
          throw new MelinnaError(errorCode(err) === 'ENOSPC' ? 'DISK_FULL' : 'IO_ERROR', { cause: err });
        }
      }
      this.file = draft;
      for (const listener of this.listeners) listener();
    });
  }
}
