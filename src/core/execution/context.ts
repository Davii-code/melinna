import type { CatalogService } from '../catalog/catalog-service';
import type { GitRunner } from '../git/git-runner';
import type { KeyedMutex } from '../git/repo-mutex';
import type { AppPaths } from '../paths';
import type { Execution } from '../persistence/state-schema';
import type { Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { HostClient } from '../ports/host-client';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import type { WorkspaceModel } from '../workspace/workspace-model';
import type { BusyTracker } from './busy-tracker';

/** Fornece o cliente do hospedeiro: `get` inicia um hospedeiro se preciso; `existing` só conecta a um vivo. */
export interface HostProvider {
  get(): Promise<HostClient>;
  existing(): Promise<HostClient | null>;
}

export interface TermSize {
  cols: number;
  rows: number;
}

export interface ExecutionDeps {
  model: WorkspaceModel;
  catalog: CatalogService;
  git: GitRunner;
  fs: FileSystem;
  mutex: KeyedMutex;
  paths: AppPaths;
  os: OsName;
  clock: Clock;
  log: Logger;
  hosts: HostProvider;
  /** Ambiente herdado pelos agentes (o do usuário). */
  baseEnv: Record<string, string>;
}

export interface ExecutionContext extends ExecutionDeps {
  busy: BusyTracker;
  update(execId: string, patch: Partial<Execution>): void;
}
