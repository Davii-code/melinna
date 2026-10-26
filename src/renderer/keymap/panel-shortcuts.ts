import { useEffect, useRef } from 'react';
import type { SidebarPanel } from '../prefs';

const PANEL_BY_CODE: Record<string, SidebarPanel> = {
  Digit0: 'commit',
  Digit1: 'workspaces',
  Digit2: 'files',
  Numpad0: 'commit',
  Numpad1: 'workspaces',
  Numpad2: 'files',
};

/** Painel de uma tecla Alt+0/1/2 (sem Ctrl, Shift nem Meta); `null` para qualquer outra. */
export function panelForKey(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey' | 'code'>): SidebarPanel | null {
  if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return null;
  return PANEL_BY_CODE[e.code] ?? null;
}

/** A tecla veio de dentro de um terminal (xterm). */
export function inTerminal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.xterm, .terminal-host') !== null;
}

/**
 * Alt+0/1/2 trocam o painel lateral. Com o foco no terminal a tecla segue para o PTY (readline e zsh
 * usam Alt+dígito como argumento numérico); nesse caso o painel se troca pelos ícones.
 */
export function usePanelShortcuts(onSelect: (panel: SidebarPanel) => void): void {
  const current = useRef(onSelect);
  current.current = onSelect;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat) return;
      const panel = panelForKey(e);
      if (panel === null || inTerminal(e.target)) return;
      e.preventDefault();
      current.current(panel);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
