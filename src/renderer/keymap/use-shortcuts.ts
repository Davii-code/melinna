import { useEffect, useRef } from 'react';
import type { KeymapId } from '../../shared/ipc-contract';
import type { RunStore } from '../store/run-store';
import { actionFor, isMac, type AppAction } from './keymaps';

/** `false` = a ação não se aplica agora (ex.: salvar sem editor em foco): a tecla segue para quem estava em foco. */
export type ShortcutHandlers = Partial<Record<AppAction, () => boolean | void>>;

/**
 * Um único ouvinte de teclado, em fase de captura na janela: roda antes do xterm e do editor, então o
 * atalho do mapa atual funciona com qualquer foco e a tecla não chega ao PTY. Tecla fora do mapa não é
 * tocada; repetição de tecla (segurar) não repete a ação.
 */
export function useShortcuts(keymap: KeymapId, handlers: ShortcutHandlers): void {
  const current = useRef({ keymap, handlers });
  current.current = { keymap, handlers };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const action = actionFor(current.current.keymap, e, isMac());
      if (action === null) return;
      const handler = current.current.handlers[action];
      if (!handler) return;
      if (e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (handler() === false) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/** Rodar e Parar do mapa: chamam a configuração ativa do `run-store`. */
export function runShortcutHandlers(store: Pick<RunStore, 'run' | 'stop'>): ShortcutHandlers {
  return {
    runActive: () => {
      void store.run();
    },
    stop: () => {
      void store.stop();
    },
  };
}
