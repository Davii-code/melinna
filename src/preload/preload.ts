/// <reference lib="dom" />
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import {
  CHANNELS,
  EVENTS,
  TERMINAL_PORT_SOURCE,
  type MelinnaApi,
  type TerminalPortEnvelope,
  type Unsubscribe,
} from '../shared/ipc-contract';

type Invoker = (...args: unknown[]) => Promise<never>;

function invoker(channel: string): Invoker {
  return (...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<never>;
}

function group<K extends string>(channels: Record<K, string>): Record<K, Invoker> {
  const out = {} as Record<K, Invoker>;
  for (const key of Object.keys(channels) as K[]) out[key] = invoker(channels[key]);
  return out;
}

function subscribe<T>(event: string, fn: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T) => fn(payload);
  ipcRenderer.on(event, listener);
  return () => {
    ipcRenderer.removeListener(event, listener);
  };
}

export function buildApi(): MelinnaApi {
  return {
    catalog: group(CHANNELS.catalog),
    workspace: {
      ...group(CHANNELS.workspace),
      onChange: (fn) => subscribe(EVENTS.workspaceChanged, fn),
    },
    tasks: group(CHANNELS.tasks),
    executions: group(CHANNELS.executions),
    terminal: group(CHANNELS.terminal),
    layout: group(CHANNELS.layout),
    files: {
      ...group(CHANNELS.files),
      pathOf: (file) => webUtils.getPathForFile(file as File),
    },
    git: {
      ...group(CHANNELS.git),
      onProgress: (fn) => subscribe(EVENTS.gitProgress, fn),
    },
    attachments: group(CHANNELS.attachments),
    prompts: {
      ...group(CHANNELS.prompts),
      queue: group(CHANNELS.promptQueue),
      onChange: (fn) => subscribe<void>(EVENTS.promptsChanged, () => fn()),
      onQueueDiscarded: (fn) => subscribe(EVENTS.queueDiscarded, fn),
    },
    run: group(CHANNELS.run),
    prefs: group(CHANNELS.prefs),
    app: {
      ...group(CHANNELS.app),
      onCloseRequested: (fn) => subscribe(EVENTS.closeRequested, fn),
    },
  };
}

/** O contextBridge não transfere MessagePort: o principal envia o port por `webContents.postMessage` e o preload o repassa à página. */
export function relayTerminalPorts(): void {
  ipcRenderer.on(EVENTS.terminalPort, (event, msg: { execId: string; channelId: string }) => {
    const envelope: TerminalPortEnvelope = {
      source: TERMINAL_PORT_SOURCE,
      execId: msg.execId,
      channelId: msg.channelId,
    };
    window.postMessage(envelope, window.location.origin, event.ports);
  });
}

contextBridge.exposeInMainWorld('melinna', buildApi());
relayTerminalPorts();
