import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  BrowserWindow,
  MessageChannelMain,
  type MessagePortMain,
  app,
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
import { CatalogService } from '../core/catalog/catalog-service';
import { ExecutionService } from '../core/execution/execution-service';
import { FileStatusService } from '../core/files/file-status';
import { FilesService } from '../core/files/files-service';
import { navigationRoots } from '../core/files/roots';
import { DiffService } from '../core/git/diff';
import { GitRunner } from '../core/git/git-runner';
import { KeyedMutex } from '../core/git/repo-mutex';
import { findOrphanLeases } from '../core/git/residue';
import { JsonlSink } from '../core/log/jsonl-sink';
import { createLogger } from '../core/log/logger';
import { makePaths } from '../core/paths';
import { StateStore } from '../core/persistence/state-store';
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
  const workspace = new WorkspaceService({
    model,
    git,
    clock,
    log: log.child('workspace'),
    residue: { git, fs, mutex, os: platform.os, paths },
  });
  const executions = new ExecutionService({
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

  const diff = new DiffService({ model, git, fs, os: platform.os, log: log.child('diff') });

  const navigationRootsOf = () => navigationRoots(model.raw);
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

  await executions.reconcileWithHost().catch((err: unknown) => log.error('host.reconcile_failed', { err }));
  executions.resumePendingSwitches();
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
    liveCount: () => executions.liveCount(),
    stopAll: (ms) => executions.stopAll(ms),
    askPage: (info) => win.webContents.send(EVENTS.closeRequested, info),
    quit: () => {
      void bridge.closeAll().finally(() => {
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
  registerIpc(handle, {
    catalog,
    workspace,
    executions,
    diff,
    files,
    fileStatus,
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
    openExternal: (url) => shell.openExternal(url),
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
