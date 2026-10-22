import { beforeEach, describe, expect, it, vi } from 'vitest';

const exposed: Record<string, unknown> = {};
const listeners = new Map<string, ((e: unknown, payload: unknown) => void)[]>();
const invoke = vi.fn(async (..._args: unknown[]) => ({ ok: true, value: null }));
const removeListener = vi.fn();
const posted: unknown[][] = [];

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => (exposed[key] = api) },
  ipcRenderer: {
    invoke: (...args: unknown[]) => invoke(...args),
    on: (ch: string, fn: (e: unknown, p: unknown) => void) =>
      listeners.set(ch, [...(listeners.get(ch) ?? []), fn]),
    removeListener: (...args: unknown[]) => removeListener(...args),
  },
}));

beforeEach(async () => {
  (globalThis as unknown as { window: unknown }).window = {
    location: { origin: 'app://melinna' },
    postMessage: (...args: unknown[]) => posted.push(args),
  };
  await import('../../../src/preload/preload');
});

const CONTRACT = {
  catalog: ['detectAll', 'list'],
  workspace: [
    'cleanResidue',
    'createGroup',
    'inspectRepo',
    'onChange',
    'openWorkspace',
    'pickRepository',
    'renameGroup',
    'renameTask',
    'snapshot',
  ],
  tasks: ['addExecution', 'createAndLaunch', 'remove', 'removeWorkspace'],
  executions: [
    'cancelPendingSwitch',
    'confirmSwitch',
    'diff',
    'divergence',
    'relaunch',
    'removalCheck',
    'remove',
    'requestSwitch',
    'stop',
  ],
  terminal: ['close', 'open'],
  layout: ['get', 'set'],
  files: ['list', 'read', 'roots', 'status', 'write'],
  app: ['answerClose', 'onCloseRequested', 'openExternal'],
};

describe('preload', () => {
  it('exposes exactly the keys of contracts/ipc.md on window.melinna', () => {
    const api = exposed.melinna as Record<string, Record<string, unknown>>;
    expect(Object.keys(api).sort()).toEqual(Object.keys(CONTRACT).sort());
    for (const [k, methods] of Object.entries(CONTRACT)) expect(Object.keys(api[k]!).sort()).toEqual(methods);
  });

  it('invokes the matching channel with the arguments', async () => {
    const api = exposed.melinna as {
      workspace: { inspectRepo(a: string, b: string): Promise<unknown> };
      terminal: { open(id: string): Promise<unknown> };
    };
    await api.workspace.inspectRepo('/repo', 'main');
    await api.terminal.open('e1');
    expect(invoke.mock.calls).toEqual([
      ['workspace:inspectRepo', '/repo', 'main'],
      ['terminal:open', 'e1'],
    ]);
  });

  it('subscribes to events and unsubscribes', () => {
    const api = exposed.melinna as { workspace: { onChange(fn: (s: unknown) => void): () => void } };
    const got: unknown[] = [];
    const off = api.workspace.onChange((s) => got.push(s));
    listeners.get('workspace:changed')!.at(-1)!({}, { version: 1 });
    expect(got).toEqual([{ version: 1 }]);
    off();
    expect(removeListener).toHaveBeenCalledWith('workspace:changed', expect.any(Function));
  });

  it('relays terminal ports to the page with window.postMessage on its own origin', () => {
    const port = { fake: 'port' };
    listeners.get('terminal:port')!.at(-1)!({ ports: [port] }, { execId: 'e1', channelId: 'c1' });
    expect(posted.at(-1)).toEqual([
      { source: 'melinna-terminal', execId: 'e1', channelId: 'c1' },
      'app://melinna',
      [port],
    ]);
  });
});
