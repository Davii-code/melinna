import { writeFileAtomic } from '../core/persistence/atomic-file';
import type { FileSystem } from '../core/ports/file-system';
import type { Logger } from '../core/ports/logger';

export const REGISTRY_SCHEMA_VERSION = 1;

export interface RegistryEntry {
  pid: number;
  startedAt: string;
  exitCode: number | null;
  signal: string | null;
  endedAt: string | null;
  totalBytes: number;
}

export interface RegistryFile {
  schemaVersion: number;
  processes: Record<string, RegistryEntry>;
}

/** `host/registry.json`: processos lançados por hospedeiros, gravado de forma atômica em spawn e exit. */
export class HostRegistry {
  private data: RegistryFile = { schemaVersion: REGISTRY_SCHEMA_VERSION, processes: {} };
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: FileSystem,
    private readonly path: string,
    private readonly log: Logger,
  ) {}

  /** Lê o registro anterior; ausente ou corrompido vira registro vazio. */
  async load(): Promise<RegistryFile> {
    try {
      const raw = JSON.parse(
        new TextDecoder().decode(await this.fs.readFile(this.path)),
      ) as Partial<RegistryFile>;
      if (raw && typeof raw.processes === 'object' && raw.processes !== null) {
        this.data = { schemaVersion: REGISTRY_SCHEMA_VERSION, processes: raw.processes };
      }
    } catch {
      this.data = { schemaVersion: REGISTRY_SCHEMA_VERSION, processes: {} };
    }
    return structuredClone(this.data);
  }

  get(execId: string): RegistryEntry | undefined {
    return this.data.processes[execId];
  }

  set(execId: string, entry: RegistryEntry): Promise<void> {
    this.data.processes[execId] = entry;
    return this.save();
  }

  update(execId: string, patch: Partial<RegistryEntry>): Promise<void> {
    const current = this.data.processes[execId];
    if (!current) return Promise.resolve();
    this.data.processes[execId] = { ...current, ...patch };
    return this.save();
  }

  private save(): Promise<void> {
    const json = JSON.stringify(this.data);
    this.chain = this.chain
      .then(() => writeFileAtomic(this.fs, this.path, json))
      .catch((err: unknown) => this.log.error('registry.save_failed', { err }));
    return this.chain;
  }
}
