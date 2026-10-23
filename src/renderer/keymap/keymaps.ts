import type { KeymapId } from '../../shared/ipc-contract';

export type AppAction =
  'goToFile' | 'save' | 'closeTab' | 'toggleSidebar' | 'promptLibrary' | 'runActive' | 'stop';

export const ACTIONS: readonly AppAction[] = [
  'goToFile',
  'save',
  'closeTab',
  'toggleSidebar',
  'promptLibrary',
  'runActive',
  'stop',
];

export const ACTION_LABEL: Record<AppAction, string> = {
  goToFile: 'Ir para arquivo',
  save: 'Salvar',
  closeTab: 'Fechar aba',
  toggleSidebar: 'Barra lateral',
  promptLibrary: 'Biblioteca de prompts',
  runActive: 'Rodar configuração ativa',
  stop: 'Parar',
};

export const KEYMAP_LABEL: Record<KeymapId, string> = {
  windows: 'Windows',
  intellij: 'IntelliJ IDEA',
  eclipse: 'Eclipse',
  vscode: 'VS Code',
};

/** Tecla em texto: modificadores (`Mod` = Ctrl, ou Cmd no macOS; `Shift`; `Alt`) e a tecla, unidos por `+`. */
export type KeyChord = string;

/**
 * Um mapa por conjunto de hábitos. Fora deles ficam as teclas do terminal (Ctrl+C/D/Z/B, setas, readline) e
 * as reservadas pelo sistema; ação sem tecla (`null`) fica só nos botões. Ctrl+Shift+F (busca no terminal)
 * segue fixo, fora dos mapas.
 */
export const KEYMAPS: Record<KeymapId, Record<AppAction, KeyChord | null>> = {
  windows: {
    goToFile: 'Mod+P',
    save: 'Mod+S',
    closeTab: 'Mod+W',
    toggleSidebar: 'Mod+Shift+B',
    promptLibrary: 'Mod+Shift+P',
    runActive: 'Mod+F5',
    stop: 'Shift+F5',
  },
  intellij: {
    goToFile: 'Mod+Shift+N',
    save: 'Mod+S',
    closeTab: 'Mod+F4',
    toggleSidebar: 'Mod+Shift+F12',
    promptLibrary: 'Mod+Shift+A',
    runActive: 'Shift+F10',
    stop: 'Mod+F2',
  },
  eclipse: {
    goToFile: 'Mod+Shift+R',
    save: 'Mod+S',
    closeTab: 'Mod+W',
    toggleSidebar: null,
    promptLibrary: 'Mod+Shift+L',
    runActive: 'Mod+F11',
    stop: 'Mod+F2',
  },
  vscode: {
    goToFile: 'Mod+P',
    save: 'Mod+S',
    closeTab: 'Mod+W',
    toggleSidebar: 'Mod+Shift+E',
    promptLibrary: 'Mod+Shift+P',
    runActive: 'Mod+F5',
    stop: 'Shift+F5',
  },
};

export interface ParsedChord {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export function parseChord(chord: KeyChord): ParsedChord {
  const parts = chord.split('+');
  const key = parts[parts.length - 1] ?? '';
  const modifiers = new Set(parts.slice(0, -1));
  return { mod: modifiers.has('Mod'), shift: modifiers.has('Shift'), alt: modifiers.has('Alt'), key };
}

export function isMac(): boolean {
  const platform = typeof navigator === 'undefined' ? '' : navigator.platform;
  return /^Mac/i.test(platform);
}

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** A tecla do evento é exatamente esta combinação (modificadores a mais ou a menos não valem). */
export function chordMatches(chord: KeyChord, e: KeyEventLike, mac: boolean): boolean {
  const c = parseChord(chord);
  const modDown = mac ? e.metaKey : e.ctrlKey;
  const otherDown = mac ? e.ctrlKey : e.metaKey;
  return (
    modDown === c.mod &&
    !otherDown &&
    e.shiftKey === c.shift &&
    e.altKey === c.alt &&
    e.key.toLowerCase() === c.key.toLowerCase()
  );
}

/** A ação que o mapa associa a este evento, se houver. */
export function actionFor(keymap: KeymapId, e: KeyEventLike, mac: boolean): AppAction | null {
  const map = KEYMAPS[keymap];
  for (const action of ACTIONS) {
    const chord = map[action];
    if (chord !== null && chordMatches(chord, e, mac)) return action;
  }
  return null;
}

export function formatChord(chord: KeyChord, mac: boolean): string {
  return chord
    .split('+')
    .map((part) => (part === 'Mod' ? (mac ? 'Cmd' : 'Ctrl') : part))
    .join('+');
}

/** Texto da tecla da ação no mapa, para dicas e títulos; `null` quando o mapa não tem tecla para ela. */
export function shortcutLabel(keymap: KeymapId, action: AppAction, mac: boolean = isMac()): string | null {
  const chord = KEYMAPS[keymap][action];
  return chord === null ? null : formatChord(chord, mac);
}
