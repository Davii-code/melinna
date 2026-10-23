import { errorCode, type FileSystem } from '../ports/file-system';
import type { Cancel, Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import { writeFileAtomic } from './atomic-file';
import { STATE_SCHEMA_VERSION, emptyState, parseState, type StateFile } from './state-schema';

export type StateWarning = 'corrupt' | 'newer-schema';

export interface StateLoadResult {
  state: StateFile;
  readOnly: boolean;
  warning?: StateWarning;
  corruptBackupPath?: string;
}

const DEBOUNCE_MS = 300;

export class StateStore {
  private pending: StateFile | undefined;
  private cancelTimer: Cancel | undefined;
  private writing: Promise<void> = Promise.resolve();
  private readOnly = false;
  /** Bytes do arquivo de esquema anterior, copiados para `.v2.json.bak` antes da primeira gravação nova. */
  private legacyBytes: Uint8Array | undefined;

  constructor(
    private readonly fs: FileSystem,
    private readonly path: string,
    private readonly clock: Clock,
    private readonly log: Logger,
  ) {}

  async load(): Promise<StateLoadResult> {
    let bytes: Uint8Array;
    try {
      bytes = await this.fs.readFile(this.path);
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return { state: emptyState(), readOnly: false };
      throw err;
    }
    let parsed: StateFile | null = null;
    try {
      parsed = parseState(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      const stamp = this.clock.now().toISOString().replace(/[:.]/g, '-');
      const backup = this.path.replace(/state\.json$/, `state.corrupt-${stamp}.json`);
      await this.fs.rename(this.path, backup);
      this.log.warn('state.corrupt', { backup });
      return { state: emptyState(), readOnly: false, warning: 'corrupt', corruptBackupPath: backup };
    }
    if (parsed.schemaVersion > STATE_SCHEMA_VERSION) {
      this.readOnly = true;
      this.log.warn('state.newer_schema', { schemaVersion: parsed.schemaVersion });
      return { state: parsed, readOnly: true, warning: 'newer-schema' };
    }
    if (parsed.schemaVersion < STATE_SCHEMA_VERSION) this.legacyBytes = bytes;
    return { state: parsed, readOnly: false };
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Agenda a gravação; chamadas próximas em até 300 ms viram uma só. */
  save(state: StateFile): void {
    if (this.readOnly) return;
    this.pending = state;
    this.cancelTimer?.();
    this.cancelTimer = this.clock.setTimeout(() => {
      this.cancelTimer = undefined;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  /** Grava imediatamente o que estiver pendente. */
  async flush(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    const state = this.pending;
    this.pending = undefined;
    if (state) {
      await this.backupLegacy();
      const json = JSON.stringify({ ...state, schemaVersion: STATE_SCHEMA_VERSION }, null, 2);
      this.writing = this.writing
        .then(() => writeFileAtomic(this.fs, this.path, json))
        .catch((err: unknown) => {
          this.log.error('state.save_failed', { err });
        });
    }
    await this.writing;
  }

  /** Guarda uma cópia do arquivo anterior antes de sobrescrevê-lo com o esquema novo; uma vez só. */
  private async backupLegacy(): Promise<void> {
    const bytes = this.legacyBytes;
    if (!bytes) return;
    this.legacyBytes = undefined;
    const backup = this.path.replace(/state\.json$/, 'state.v2.json.bak');
    try {
      await writeFileAtomic(this.fs, backup, bytes);
      this.log.info('state.legacy_backup', {});
    } catch (err) {
      this.log.error('state.legacy_backup_failed', { err });
    }
  }
}
