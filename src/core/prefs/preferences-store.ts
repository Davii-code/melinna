import { MelinnaError } from '../errors';
import type { KeyedMutex } from '../git/repo-mutex';
import { writeFileAtomic } from '../persistence/atomic-file';
import { errorCode, type FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import {
  DEFAULT_KEYMAP,
  PREFERENCES_FILE_VERSION,
  isKeymapId,
  type ActiveRunRef,
  type KeymapId,
  type Preferences,
  type PreferencesFile,
} from './types';

export interface PreferencesStoreDeps {
  fs: FileSystem;
  path: string;
  log: Logger;
  mutex: KeyedMutex;
}

const MUTEX_KEY = 'preferences';

function defaults(): PreferencesFile {
  return { version: PREFERENCES_FILE_VERSION, keymap: DEFAULT_KEYMAP, activeRun: null };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseActiveRun(v: unknown): ActiveRunRef | null {
  if (
    isObj(v) &&
    typeof v.groupId === 'string' &&
    v.groupId.length > 0 &&
    typeof v.commandId === 'string' &&
    v.commandId.length > 0
  ) {
    return { groupId: v.groupId, commandId: v.commandId };
  }
  return null;
}

/**
 * `userData/preferences.json`: mapa de atalhos e configuração de execução ativa. A memória é a fonte de
 * leitura; cada escolha grava de forma atômica antes de valer. Arquivo inválido vale como padrões e só é
 * sobrescrito na próxima escolha; versão mais nova é só leitura (escolhas valem na sessão).
 */
export class PreferencesStore {
  private file: PreferencesFile = defaults();
  private readOnly = false;

  constructor(private readonly deps: PreferencesStoreDeps) {}

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
    if (!isObj(json) || typeof json.version !== 'number') {
      log.warn('prefs.load_failed', {});
      return;
    }
    if (json.version > PREFERENCES_FILE_VERSION) {
      this.readOnly = true;
      log.warn('prefs.newer_version', { version: json.version });
    }
    this.file = {
      version: PREFERENCES_FILE_VERSION,
      keymap: isKeymapId(json.keymap) ? json.keymap : DEFAULT_KEYMAP,
      activeRun: parseActiveRun(json.activeRun),
    };
  }

  get(): Preferences {
    return { keymap: this.file.keymap, activeRun: this.file.activeRun, readOnly: this.readOnly };
  }

  setKeymap(keymap: KeymapId): Promise<void> {
    return this.update((draft) => {
      draft.keymap = keymap;
    });
  }

  setActiveRun(ref: ActiveRunRef | null): Promise<void> {
    return this.update((draft) => {
      draft.activeRun = ref;
    });
  }

  private update(fn: (draft: PreferencesFile) => void): Promise<void> {
    return this.deps.mutex.run(MUTEX_KEY, async () => {
      const draft = structuredClone(this.file);
      fn(draft);
      if (!this.readOnly) {
        try {
          await writeFileAtomic(this.deps.fs, this.deps.path, JSON.stringify(draft, null, 2));
        } catch (err) {
          this.deps.log.error('prefs.save_failed', { err });
          throw new MelinnaError(errorCode(err) === 'ENOSPC' ? 'DISK_FULL' : 'IO_ERROR', { cause: err });
        }
      }
      this.file = draft;
    });
  }
}
