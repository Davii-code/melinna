import { createContext, useContext, useSyncExternalStore } from 'react';
import type { KeymapId, MelinnaApi, ResultError } from '../../shared/ipc-contract';
import { shortcutLabel, type AppAction } from './keymaps';

export interface KeymapStore {
  get(): KeymapId;
  subscribe(fn: () => void): () => void;
  /** Lê o mapa guardado nas preferências. */
  load(): Promise<void>;
  /** Troca na hora e grava; se a gravação falha, volta ao anterior e avisa. */
  set(keymap: KeymapId): Promise<void>;
}

export function createKeymapStore(api: MelinnaApi, onError: (error: ResultError) => void): KeymapStore {
  let current: KeymapId = 'windows';
  const listeners = new Set<() => void>();
  const apply = (keymap: KeymapId) => {
    if (keymap === current) return;
    current = keymap;
    for (const fn of listeners) fn();
  };
  return {
    get: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async load() {
      const r = await api.prefs.get();
      if (r.ok) apply(r.value.keymap);
    },
    async set(keymap) {
      const previous = current;
      apply(keymap);
      const r = await api.prefs.setKeymap(keymap);
      if (!r.ok) {
        apply(previous);
        onError(r.error);
      }
    },
  };
}

export function useKeymap(store: KeymapStore): KeymapId {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** O mapa em uso, para dicas e títulos; sem provedor vale o Windows. */
export const KeymapContext = createContext<KeymapId>('windows');

/** "Ctrl+P" ou o que o mapa atual diz; `null` se o mapa não tem tecla para a ação. */
export function useShortcutLabel(action: AppAction): string | null {
  return shortcutLabel(useContext(KeymapContext), action);
}

/** Acrescenta a tecla ao texto de uma dica: "Salvar (Ctrl+S)". */
export function withShortcut(text: string, label: string | null): string {
  return label === null ? text : `${text} (${label})`;
}
