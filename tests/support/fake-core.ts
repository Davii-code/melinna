import { CatalogService } from '../../src/core/catalog/catalog-service';
import { ExecutionService } from '../../src/core/execution/execution-service';
import { GitRunner } from '../../src/core/git/git-runner';
import { KeyedMutex } from '../../src/core/git/repo-mutex';
import { makePaths } from '../../src/core/paths';
import { emptyState, type StateFile } from '../../src/core/persistence/state-schema';
import { StateStore } from '../../src/core/persistence/state-store';
import { WorkspaceModel } from '../../src/core/workspace/workspace-model';
import { WorkspaceService } from '../../src/core/workspace/workspace-service';
import { FakeClock } from './fakes/clock';
import { MemoryFileSystem } from './fakes/file-system';
import { FakeHostClient } from './fakes/host-client';
import { MemoryLogger } from './fakes/logger';
import { fakePlatform } from './fakes/platform';
import { FakeProcessRunner, failed, ok } from './fakes/process-runner';

export const BASE_SHA = 'b'.repeat(40);

function agent(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    displayName: id,
    kind: 'agent',
    executable: { command: '/bin/fake' },
    args: [],
    prompt: { delivery: 'argument', args: ['{prompt}'] },
    model: {
      options: [
        { id: 'rapido', label: 'Rápido' },
        { id: 'esperto', label: 'Esperto' },
      ],
      default: 'rapido',
      allowCustom: true,
      args: ['--model', '{model}'],
      switch: { strategy: 'pty-command', template: '/model {model}\r' },
    },
    permission: {
      options: [
        { id: 'perguntar', label: 'Perguntar', args: [] },
        { id: 'livre', label: 'Livre', args: ['--yolo'], dangerous: true },
      ],
      default: 'perguntar',
      switch: { strategy: 'pty-command', template: '/permission {permission}\r' },
    },
    resume: { args: ['--resume'] },
    detect: { strategy: 'path' },
    ...extra,
  };
}

export const FAKE_AGENTS = {
  fake: agent('fake'),
  'fake-resume': agent('fake-resume', {
    model: { ...agent('x').model, allowCustom: false, switch: { strategy: 'restart-resume' } },
    permission: { ...agent('x').permission, switch: { strategy: 'restart-resume' } },
  }),
  'fake-nosw': agent('fake-nosw', {
    model: { ...agent('x').model, allowCustom: false, switch: { strategy: 'unsupported' } },
    permission: { ...agent('x').permission, switch: { strategy: 'unsupported' } },
  }),
  bash: {
    id: 'bash',
    displayName: 'Bash',
    kind: 'shell',
    executable: { command: '/bin/bash' },
    args: [],
    prompt: { delivery: 'none' },
    detect: { strategy: 'path' },
  },
};

export interface FakeCore {
  fs: MemoryFileSystem;
  clock: FakeClock;
  log: MemoryLogger;
  runner: FakeProcessRunner;
  host: FakeHostClient;
  model: WorkspaceModel;
  workspace: WorkspaceService;
  executions: ExecutionService;
  catalog: CatalogService;
  store: StateStore;
}

/** Núcleo completo sobre fakes em memória (git programável, hospedeiro falso). */
export function createFakeCore(state: StateFile = emptyState()): FakeCore {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  fs.seed('/bin/fake', '');
  fs.seed('/bin/bash', '');
  fs.seed(
    '/app/catalog/agents.json',
    JSON.stringify({ schemaVersion: 1, agents: Object.values(FAKE_AGENTS) }),
  );
  const clock = new FakeClock(Date.parse('2026-03-01T10:00:00.000Z'));
  const log = new MemoryLogger();
  const branches = new Set<string>();
  const runner = new FakeProcessRunner()
    .on((_f, args) => (args.includes('--show-toplevel') ? ok('/repo\n') : undefined))
    .on((_f, args) => {
      const ref = args.find((a) => a.startsWith('refs/heads/'));
      if (!ref) return undefined;
      return branches.has(ref.slice(11)) ? ok('sha') : failed(1);
    })
    .on((_f, args) =>
      args.some((a) => a.endsWith('^{commit}'))
        ? args.some((a) => a.startsWith('nao-existe'))
          ? failed(1)
          : ok(`${BASE_SHA}\n`)
        : undefined,
    )
    .on((_f, args) => (args.includes('check-ref-format') ? ok() : undefined))
    .on((_f, args) => (args.includes('status') ? ok('') : undefined))
    .on((_f, args) =>
      args.includes('list') && args.includes('worktree') ? ok('worktree /repo\0') : undefined,
    )
    .on((_f, args) => {
      if (!args.includes('worktree') || !args.includes('add')) return undefined;
      const b = args[args.indexOf('-b') + 1];
      if (b) branches.add(b);
      return ok();
    })
    .on(() => ok());
  const git = new GitRunner(runner, log);
  const mutex = new KeyedMutex();
  const paths = makePaths('/data', 'linux');
  const store = new StateStore(fs, paths.state, clock, log);
  const model = new WorkspaceModel(state, store);
  const platform = fakePlatform('linux', '/bin');
  const catalog = new CatalogService({
    fs,
    platform,
    log,
    builtinPath: '/app/catalog/agents.json',
    userPath: paths.userCatalog,
  });
  const host = new FakeHostClient();
  const workspace = new WorkspaceService({
    model,
    git,
    clock,
    log,
    residue: { git, fs, mutex, os: 'linux', paths },
  });
  const executions = new ExecutionService({
    model,
    catalog,
    git,
    fs,
    mutex,
    paths,
    os: 'linux',
    clock,
    log,
    hosts: { get: async () => host, existing: async () => host },
    baseEnv: { PATH: '/bin' },
  });
  return { fs, clock, log, runner, host, model, workspace, executions, catalog, store };
}

/** Coleta os handlers registrados num `Handle`. */
export function handleRecorder() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return {
    handle: (channel: string, fn: (...args: unknown[]) => Promise<unknown>) => {
      if (handlers.has(channel)) throw new Error(`canal duplicado ${channel}`);
      handlers.set(channel, fn);
    },
    call: (channel: string, ...args: unknown[]) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`sem handler ${channel}`);
      return fn(...args) as Promise<{
        ok: boolean;
        value?: unknown;
        error?: { code: string; message: string };
      }>;
    },
    channels: () => [...handlers.keys()].sort(),
  };
}
