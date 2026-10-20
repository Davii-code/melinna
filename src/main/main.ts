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
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
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
      appPath: app.getAppPath(),
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

  await executions.reconcileWithHost().catch((err: unknown) => log.error('host.reconcile_failed', { err }));
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
  const trustedOrigin = devUrl ? new URL(devUrl).origin : APP_ORIGIN;
  const win = createMainWindow({
    create: (opts) => new BrowserWindow(opts),
    preloadPath: preloadPath(__dirname),
    url: devUrl ?? `${APP_ORIGIN}/index.html`,
  });
  mainWindow = win;

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
      return new URL(url).origin === trustedOrigin;
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
    model,
    bridge,
    closeFlow,
    log: log.child('ipc'),
    pickRepository: async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Escolher repositório',
        properties: ['openDirectory'],
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
