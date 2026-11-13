import type { DraftStore } from './editor-session';
export interface DiskDraft {
  content: string;
  hash: string;
  binary: boolean;
  truncated?: boolean;
}
export type ExternalChange = DiskDraft | { error: string };
const watchers = new WeakMap<
  DraftStore,
  { listeners: Set<(path: string, change: ExternalChange) => void>; stop(): void }
>();

/** Uma leitura por sessão/foco, mesmo com o documento em vários splits. */
export function watchExternalDrafts(
  store: DraftStore,
  read: (path: string) => Promise<DiskDraft>,
  listener: (path: string, change: ExternalChange) => void,
): () => void {
  let watcher = watchers.get(store);
  if (!watcher) {
    const listeners = new Set<(path: string, change: ExternalChange) => void>();
    let running = false;
    const check = () => {
      if (running) return;
      running = true;
      void syncExternalDrafts(
        store,
        read,
        (path, change) => {
          for (const fn of listeners) fn(path, change);
        },
        () => listeners.size > 0,
      ).finally(() => {
        running = false;
      });
    };
    window.addEventListener('focus', check, true);
    watcher = { listeners, stop: () => window.removeEventListener('focus', check, true) };
    watchers.set(store, watcher);
  }
  const entry = watcher;
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) {
      entry.stop();
      watchers.delete(store);
    }
  };
}

export async function syncExternalDrafts(
  store: DraftStore,
  read: (path: string) => Promise<DiskDraft>,
  conflict: (path: string, change: ExternalChange) => void,
  active: () => boolean = () => true,
): Promise<void> {
  for (const [path, before] of Object.entries(store.snapshot())) {
    if (!active()) return;
    try {
      const disk = await read(path);
      if (!active() || store.snapshot()[path] !== before || disk.hash === before.baseHash) continue;
      if (before.dirty || disk.binary || disk.truncated) conflict(path, disk);
      else store.set(path, { text: disk.content, baseHash: disk.hash, dirty: false });
    } catch (error) {
      if (active() && store.snapshot()[path] === before)
        conflict(path, {
          error: error instanceof Error ? error.message : 'Não foi possível atualizar o arquivo.',
        });
    }
  }
}
