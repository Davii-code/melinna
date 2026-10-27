import { useEffect, useRef } from 'react';
import type { KeymapId } from '../../shared/ipc-contract';
import type { RunStore } from '../store/run-store';
import { actionFor, EDITOR_ONLY_ACTIONS, isMac, type AppAction } from './keymaps';

/** Ações que não são do editor, mas também não valem no terminal (a tecla segue para o PTY). */
const NOT_IN_TERMINAL: readonly AppAction[] = ['findInProject', 'reopenClosedTab', 'splitRight'];

function within(target: EventTarget | null, selector: string): boolean {
  return target instanceof Element && target.closest(selector) !== null;
}

/**
 * Ações de editor só valem com um editor em foco; com o terminal em foco a tecla segue para o PTY e o
 * evento não é tocado. Ações do app (arquivo, barra lateral, rodar…) valem com qualquer foco.
 */
function appliesAt(action: AppAction, target: EventTarget | null): boolean {
  if (within(target, '[data-shortcut-scope="task-workflow"]')) return false;
  if (action === 'toggleEditorFocus' && within(target, '[role="dialog"], [role="alertdialog"]')) return false;
  if (EDITOR_ONLY_ACTIONS.includes(action)) return within(target, '.cm-editor');
  if (NOT_IN_TERMINAL.includes(action)) return !within(target, '.xterm');
  return true;
}

/** `false` = a ação não se aplica agora (ex.: salvar sem editor em foco): a tecla segue para quem estava em foco. */
export type ShortcutHandlers = Partial<Record<AppAction, (() => boolean) | (() => void)>>;

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
      if (!appliesAt(action, e.target)) return;
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
