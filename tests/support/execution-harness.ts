import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeClock } from '../../src/adapters/node-clock';
import { NodeFileSystem } from '../../src/adapters/node-fs';
import { nodePlatform } from '../../src/adapters/node-platform';
import { NodeProcessRunner } from '../../src/adapters/node-process-runner';
import { CatalogService } from '../../src/core/catalog/catalog-service';
import type { HostProvider } from '../../src/core/execution/context';
import { ExecutionService } from '../../src/core/execution/execution-service';
import { GitRunner } from '../../src/core/git/git-runner';
import { KeyedMutex } from '../../src/core/git/repo-mutex';
import { makePaths, type AppPaths } from '../../src/core/paths';
import { emptyState } from '../../src/core/persistence/state-schema';
import { StateStore } from '../../src/core/persistence/state-store';
import type { HostClient } from '../../src/core/ports/host-client';
import { WorkspaceModel } from '../../src/core/workspace/workspace-model';
import { WorkspaceService } from '../../src/core/workspace/workspace-service';
import type { NodeHostClient } from '../../src/main/host-client';
import { fakeCatalogJson } from './fake-catalog';
import { MemoryLogger } from './fakes/logger';
import { startTestHost, type TestHost } from './host-harness';
import { currentOs } from './os';
import { removeDirRecursive } from './temp-dirs';

export interface CoreHarness {
  userData: string;
  paths: AppPaths;
  log: MemoryLogger;
  model: WorkspaceModel;
  workspace: WorkspaceService;
  executions: ExecutionService;
  catalog: CatalogService;
  testHost(): TestHost | null;
  client(): NodeHostClient | null;
  /** Derruba o hospedeiro atual (simula queda). */
  killHost(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createCoreHarness(): Promise<CoreHarness> {
  const userData = mkdtempSync(join(tmpdir(), 'melinna-core-'));
  const os = currentOs;
  const paths = makePaths(userData, os);
  writeFileSync(paths.userCatalog, fakeCatalogJson());
  const fs = new NodeFileSystem();
  const clock = new NodeClock();
  const log = new MemoryLogger();
  const runner = new NodeProcessRunner();
  const git = new GitRunner(runner, log.child('git'));
  const mutex = new KeyedMutex();
  const store = new StateStore(fs, paths.state, clock, log);
  const model = new WorkspaceModel(emptyState(), store);
  const platform = nodePlatform();
  const catalog = new CatalogService({
    fs,
    platform,
    log,
    builtinPath: join(__dirname, '..', '..', 'catalog', 'agents.json'),
    userPath: paths.userCatalog,
  });
  let th: TestHost | null = null;
  let client: NodeHostClient | null = null;
  const hosts: HostProvider = {
    async get(): Promise<HostClient> {
      if (client?.isConnected()) return client;
      th ??= await startTestHost({ userData });
      client = await th.connect();
      return client;
    },
    async existing(): Promise<HostClient | null> {
      if (client?.isConnected()) return client;
      if (!th) return null;
      client = await th.connect();
      return client;
    },
  };
  const workspace = new WorkspaceService({ model, git, clock, log, residue: { git, fs, mutex, os, paths } });
  const executions = new ExecutionService({
    model,
    catalog,
    git,
    fs,
    mutex,
    paths,
    os,
    clock,
    log,
    hosts,
    baseEnv: process.env as Record<string, string>,
  });
  return {
    userData,
    paths,
    log,
    model,
    workspace,
    executions,
    catalog,
    testHost: () => th,
    client: () => client,
    async killHost() {
      const old = th;
      th = null;
      client = null;
      if (old) {
        await old.host.supervisor.shutdown(200);
        await old.host.stop();
      }
    },
    async cleanup() {
      await th?.cleanup();
      await store.flush();
      removeDirRecursive(userData);
    },
  };
}
