import { randomUUID } from 'node:crypto';
import { JsonOrchestrationStore } from '../adapters/orchestration-store';
import { CliOrchestrationRuntime } from '../adapters/orchestration-runtime';
import { OrchestrationService } from '../core/orchestration/orchestration-service';
import { LocalDelegationBridge } from './orchestration/mcp-bridge';
import { registerOrchestration } from './ipc/register-orchestration';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  BrowserWindow,
  MessageChannelMain,
  type MessagePortMain,
  app,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { NodeClock } from '../adapters/node-clock';
import { NodeFileSystem } from '../adapters/node-fs';
import { nodePlatform } from '../adapters/node-platform';
import { NodeProcessRunner } from '../adapters/node-process-runner';
import { AttachmentService } from '../core/attachments/attachment-service';
import { CatalogService } from '../core/catalog/catalog-service';
import { ExecutionService } from '../core/execution/execution-service';
import { FileStatusService } from '../core/files/file-status';
import { FilesService } from '../core/files/files-service';
import { navigationRoots } from '../core/files/roots';
import { DiffService } from '../core/git/diff';
import { GitService } from '../core/git/git-service';
import { GitRunner } from '../core/git/git-runner';
import { KeyedMutex } from '../core/git/repo-mutex';
import { findOrphanLeases } from '../core/git/residue';
import { JsonlSink } from '../core/log/jsonl-sink';
import { createLogger } from '../core/log/logger';
import { makePaths } from '../core/paths';
import { PreferencesStore } from '../core/prefs/preferences-store';
import { PromptLibrary } from '../core/prompts/prompt-library';
import { connectQueue, PromptQueue } from '../core/prompts/prompt-queue';
import { PromptSender } from '../core/prompts/prompt-sender';
import { PromptStore } from '../core/prompts/prompt-store';
import { StateStore } from '../core/persistence/state-store';
import { RunService } from '../core/run/run-service';
import { WorkspaceModel } from '../core/workspace/workspace-model';
import { WorkspaceService } from '../core/workspace/workspace-service';
import { ensureToken } from '../host/auth';
import { EVENTS, type Result } from '../shared/ipc-contract';
import { APP_ORIGIN, APP_SCHEME, serveApp } from './app-protocol';
import { builtinCatalogPath, hostScriptPath, preloadPath, rendererRoot, userDataOverride } from './app-paths';
import { CloseFlow } from './close-flow';
import { NodeHostClient } from './host-client';
import { HostLauncher } from './host-launcher';
import { registerIpc } from './ipc/register';
import { ProjectSearcher, type SearchWorkerLike } from './search-worker';
import { createThumbnail } from './thumbnail';
import type { Handle } from './ipc/result';
import { TerminalBridge } from './ipc/terminal-ports';
import { claimSingleInstance } from './single-instance';
import { createMainWindow } from './window';

protocol.registerSchemesAsPrivileged([
  // `stream` deixa o <video> do fundo da tela inicial tocar a partir do esquema app://.
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const override = userDataOverride(process.env);
if (override) app.setPath('userData', override);

let mainWindow: BrowserWindow | null = null;

if (claimSingleInstance(app, () => mainWindow)) {
  void app.whenReady().then(boot);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function boot(): Promise<void> {
  // A interface tem barra de título própria; o menu nativo do Electron (File/Edit/View/Window) só
  // ocupava espaço com cara de app antigo.
  Menu.setApplicationMenu(null);
  const platform = nodePlatform();
  const paths = makePaths(app.getPath('userData'), platform.os);
  const fs = new NodeFileSystem();
  await fs.mkdir(paths.logsDir, { recursive: true });
  const clock = new NodeClock();
  const sink = new JsonlSink(fs, paths.mainLog);
  const log = createLogger({ sink, clock, component: 'main' });
  process.on('uncaughtException', (err) => log.error('main.uncaught', { err }));
  process.on('unhandledRejection', (err) => log.error('main.unhandled_rejection', { err }));

  const store = new StateStore(fs, paths.state, clock, log.child('state'));
  const loaded = await store.load();
  const model = new WorkspaceModel(loaded.state, store, loaded.readOnly);
  if (loaded.warning) log.warn('state.loaded_with_warning', { warning: loaded.warning });

  const git = new GitRunner(new NodeProcessRunner(), log.child('git'));
  const mutex = new KeyedMutex();
  const catalog = new CatalogService({
    fs,
    platform,
    log: log.child('catalog'),
    builtinPath: builtinCatalogPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      mainDir: __dirname,
    }),
    userPath: paths.userCatalog,
  });
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );
  const hosts = new HostLauncher({
    paths,
    log: log.child('host-launcher'),
    execPath: process.execPath,
    hostScript: hostScriptPath(__dirname),
    baseEnv,
    spawnDetached: (file, args, env) =>
      spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, env, shell: false }),
    connect: (endpoint, token) => NodeHostClient.connect(endpoint, token, log.child('host-client')),
    readText: (p) => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    },
    ensureToken,
    isPidAlive,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  });
  const promptStore = new PromptStore({
    fs,
    path: paths.promptsFile,
    clock,
    log: log.child('prompts'),
    mutex,
  });
  await promptStore.load();
  const promptLibrary = new PromptLibrary({
    store: promptStore,
    groupExists: (id) => model.group(id) !== undefined,
    clock,
    log: log.child('prompts'),
  });
  const workspace = new WorkspaceService({
    model,
    git,
    clock,
    log: log.child('workspace'),
    residue: { git, fs, mutex, os: platform.os, paths },
    onGroupRemoved: (groupId) => promptLibrary.releaseGroup(groupId),
  });
  const attachments = new AttachmentService({
    fs,
    clock,
    paths,
    log: log.child('attachments'),
  });
  const executions = new ExecutionService({
    attachments,
    model,
    catalog,
    git,
    fs,
    mutex,
    paths,
    os: platform.os,
    clock,
    log: log.child('execution'),
    hosts,
    baseEnv,
  });

  const run = new RunService({ executions, platform });
  const prefs = new PreferencesStore({
    fs,
    path: paths.preferencesFile,
    log: log.child('prefs'),
    mutex,
  });
  await prefs.load();

  const promptSender = new PromptSender({
    model,
    executions,
    clock,
    log: log.child('prompts'),
    mutex,
  });

  const promptQueue = new PromptQueue({
    store: promptStore,
    sender: promptSender,
    model,
    clock,
    log: log.child('prompts'),
    mutex,
  });
  connectQueue(executions, promptQueue, log.child('prompts'));

  const diff = new DiffService({ model, git, fs, os: platform.os, log: log.child('diff') });

  const navigationRootsOf = () =>
    navigationRoots({ ...model.raw, unavailableFolders: model.unavailableFolderIds() });
  const gitService = new GitService({
    git,
    fs,
    log: log.child('git-ui'),
    mutex,
    clock,
    os: platform.os,
    tmpdir: tmpdir(),
  });
  const files = new FilesService({
    fs,
    os: platform.os,
    log: log.child('files'),
    roots: navigationRootsOf,
  });
  const fileStatus = new FileStatusService({
    git,
    os: platform.os,
    log: log.child('files'),
    roots: navigationRootsOf,
  });
  // A busca no projeto roda numa thread (encerrada se passar do tempo); o script dela é outra entrada do build.
  const search = new ProjectSearcher({
    createWorker: (query) =>
      new Worker(join(__dirname, 'search-worker-thread.js'), {
        workerData: { query },
      }) as unknown as SearchWorkerLike,
    isRootAllowed: (root) => files.containsPath(root),
    clock,
    log: log.child('files'),
  });

  // Anexos de execuções que não existem mais (removidas com o app fechado ou por falha) saem agora.
  await attachments
    .sweepOrphans(model.raw.executions.map((e) => e.id))
    .catch((err: unknown) => log.error('attachment.sweep_failed', { err }));

  await executions.reconcileWithHost().catch((err: unknown) => log.error('host.reconcile_failed', { err }));
  executions.resumePendingSwitches();
  await promptQueue.resume().catch((err: unknown) => log.error('prompts.queue_resume_failed', { err }));
  const residues = await findOrphanLeases(
    { fs, paths, os: platform.os },
    (id) => model.execution(id) !== undefined,
  ).catch(() => []);
  if (residues.length > 0) log.warn('worktree.orphan_leases', { count: residues.length });

  serveApp({
    handle: (scheme, fn) => protocol.handle(scheme, fn),
    readFile: (p) => readFile(p),
    root: rendererRoot(__dirname),
  });

  const orchestrationRoot = join(app.getPath('userData'), 'orchestration');
  await fs.mkdir(orchestrationRoot, { recursive: true });
  const orchestrationBridge = new LocalDelegationBridge((runId, name, args) =>
    orchestration.tool(runId, name, args),
  );
  const orchestration: OrchestrationService = new OrchestrationService({
    store: new JsonOrchestrationStore(join(orchestrationRoot, 'state.json')),
    runtime: new CliOrchestrationRuntime({ catalog, fs, platform, root: orchestrationRoot, env: baseEnv }),
    bridge: orchestrationBridge,
    newId: randomUUID,
    workspace: (groupId) => model.group(groupId)?.repoPath,
    now: () => new Date().toISOString(),
    changed: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(EVENTS.orchestrationChanged);
    },
  });
  await orchestration.load().catch((err: unknown) => log.error('orchestration.load_failed', { err }));

  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const originOf = (url: string) => {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  };
  const trustedOrigin = devUrl ? originOf(devUrl) : APP_ORIGIN;
  const win = createMainWindow({
    create: (opts) => new BrowserWindow(opts),
    preloadPath: preloadPath(__dirname),
    url: devUrl ?? `${APP_ORIGIN}/index.html`,
    ...(devUrl ? { devOrigin: originOf(devUrl) } : {}),
  });
  mainWindow = win;

  // Diagnóstico da página: erro de JavaScript no renderer não aparecia em log nenhum, e a janela
  // ficava preta sem explicação. Estes três eventos cobrem console, falha de carga e morte do processo.
  const wc = win.webContents as unknown as {
    on(event: 'console-message', fn: (a: unknown, ...rest: unknown[]) => void): void;
    on(event: 'did-fail-load' | 'render-process-gone', fn: (...args: unknown[]) => void): void;
  };
  wc.on('console-message', (a, ...rest) => {
    const details = a as { message?: unknown; level?: unknown };
    const legacy = typeof rest[1] === 'string' ? rest[1] : undefined;
    const message = typeof details?.message === 'string' ? details.message : legacy;
    const level =
      typeof details?.level === 'number' || typeof details?.level === 'string' ? details.level : rest[0];
    log.warn('renderer.console', { level: String(level ?? ''), message: String(message ?? '') });
  });
  wc.on('did-fail-load', (...args) => {
    const [code, description, url] = args as [number, string, string];
    log.error('renderer.load_failed', { code, description, url });
  });
  wc.on('render-process-gone', (...args) => {
    const [details] = args as [{ reason?: string; exitCode?: number }];
    log.error('renderer.gone', { reason: details?.reason ?? '', exitCode: details?.exitCode ?? 0 });
  });

  const closeFlow = new CloseFlow({
    liveCount: () => executions.liveCount() + orchestration.liveCount(),
    stopAll: async (ms) => {
      await orchestration.shutdown();
      await executions.stopAll(ms);
    },
    askPage: (info) => win.webContents.send(EVENTS.closeRequested, info),
    quit: () => {
      void orchestration
        .shutdown()
        .catch((err: unknown) => log.error('orchestration.shutdown_failed', { err }))
        .finally(() => bridge.closeAll())
        .finally(() => {
          void model.flush().finally(() => {
            void sink.flush().finally(() => win.destroy());
          });
        });
    },
    log: log.child('close'),
  });
  win.on('close', (e) => {
    if (!closeFlow.onCloseRequested()) e.preventDefault();
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  const bridge = new TerminalBridge({
    executions,
    model,
    log: log.child('terminal'),
    createChannel: () => new MessageChannelMain(),
    target: () =>
      win.isDestroyed()
        ? null
        : {
            postMessage: (channel, message, transfer) =>
              win.webContents.postMessage(channel, message, transfer as MessagePortMain[]),
          },
  });

  const isTrusted = (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url;
    if (!url) return false;
    try {
      return originOf(url) === trustedOrigin;
    } catch {
      return false;
    }
  };
  const handle: Handle = (channel, fn) => {
    ipcMain.handle(channel, (event, ...args: unknown[]): Promise<Result<unknown>> | Result<unknown> => {
      if (!isTrusted(event))
        return { ok: false, error: { code: 'INPUT_INVALID', message: 'Origem não autorizada.' } };
      return fn(...args);
    });
  };
  registerOrchestration(handle, orchestration, log.child('orchestration'));
  registerIpc(handle, {
    catalog,
    workspace,
    executions,
    diff,
    git: gitService,
    gitRoots: () =>
      navigationRootsOf()
        .filter((r) => r.kind === 'workspace')
        .map((r) => r.path),
    os: platform.os,
    emitGitProgress: (e) => {
      if (!win.isDestroyed()) win.webContents.send(EVENTS.gitProgress, e);
    },
    files,
    fileStatus,
    search,
    run,
    prefs,
    model,
    bridge,
    closeFlow,
    log: log.child('ipc'),
    pickRepository: async (defaultPath) => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Escolher pasta',
        properties: ['openDirectory'],
        ...(defaultPath ? { defaultPath } : {}),
      });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    pickFolders: async (defaultPath) => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Escolher pastas',
        properties: ['openDirectory', 'multiSelections'],
        ...(defaultPath ? { defaultPath } : {}),
      });
      return r.canceled ? [] : r.filePaths;
    },
    attachments,
    clipboard: {
      hasImageOnly: async () => {
        const types = (await clipboard.read()).flatMap((item) => item.types);
        return types.some((t) => t.startsWith('image/')) && !types.some((t) => t.startsWith('text/'));
      },
      readImage: async () => {
        const items = await clipboard.read();
        const types = items.flatMap((item) => item.types).filter((t) => t.startsWith('image/'));
        const type = types.includes('image/png') ? 'image/png' : types[0];
        const item = items.find((i) => type !== undefined && i.types.includes(type));
        if (!item || type === undefined) return null;
        const blob = (await item.getType(type as 'image/png')) as Blob;
        return new Uint8Array(await blob.arrayBuffer());
      },
    },
    thumbnail: (bytes) => createThumbnail(bytes),
    pickImagePaths: async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Anexar imagem',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      return r.canceled ? [] : r.filePaths;
    },
    openExternal: (url) => shell.openExternal(url),
    prompts: {
      library: promptLibrary,
      sender: promptSender,
      queue: promptQueue,
      emitQueueDiscarded: (e) => {
        if (!win.isDestroyed()) win.webContents.send(EVENTS.queueDiscarded, e);
      },
    },
  });

  promptStore.subscribe(() => {
    if (!win.isDestroyed()) win.webContents.send(EVENTS.promptsChanged);
  });

  let pending: ReturnType<typeof setTimeout> | null = null;
  model.subscribe(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (!win.isDestroyed()) win.webContents.send(EVENTS.workspaceChanged, model.snapshot());
    }, 16);
  });

  app.on('window-all-closed', () => app.quit());
  log.info('app.ready', { version: app.getVersion() });
}
