import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  EDITOR_ONLY_ACTIONS,
  KEYMAPS,
  actionFor,
  chordMatches,
  formatChord,
  parseChord,
  shortcutLabel,
  type AppAction,
} from '../../../src/renderer/keymap/keymaps';
import { KEYMAP_IDS, type KeymapId } from '../../../src/shared/ipc-contract';

/** Tabela da pesquisa R8 (ações sem tecla ficam só nos botões). */
const TABLE: Record<KeymapId, Record<AppAction, string | null>> = {
  windows: {
    goToFile: 'Mod+P',
    save: 'Mod+S',
    closeTab: 'Mod+W',
    toggleSidebar: 'Mod+Shift+B',
    promptLibrary: 'Mod+Shift+P',
    runActive: 'Mod+F5',
    stop: 'Shift+F5',
    goToLine: 'Mod+G',
    goToSymbol: 'Mod+F12',
    selectNextOccurrence: 'Mod+D',
    unselectLastOccurrence: 'Mod+U',
    findInProject: 'Mod+Shift+F',
    replaceInFile: 'Mod+H',
    toggleComment: 'Mod+/',
    reindent: 'Mod+Alt+I',
    reopenClosedTab: 'Mod+Shift+T',
    splitRight: null,
  },
  intellij: {
    goToFile: 'Mod+Shift+N',
    save: 'Mod+S',
    closeTab: 'Mod+F4',
    toggleSidebar: 'Mod+Shift+F12',
    promptLibrary: 'Mod+Shift+A',
    runActive: 'Shift+F10',
    stop: 'Mod+F2',
    goToLine: 'Mod+G',
    goToSymbol: 'Mod+F12',
    selectNextOccurrence: 'Alt+J',
    unselectLastOccurrence: 'Shift+Alt+J',
    findInProject: 'Mod+Shift+F',
    replaceInFile: 'Mod+R',
    toggleComment: 'Mod+/',
    reindent: 'Mod+Alt+I',
    reopenClosedTab: 'Mod+Shift+T',
    splitRight: null,
  },
  eclipse: {
    goToFile: 'Mod+Shift+R',
    save: 'Mod+S',
    closeTab: 'Mod+W',
    toggleSidebar: null,
    promptLibrary: 'Mod+Shift+L',
    runActive: 'Mod+F11',
    stop: 'Mod+F2',
    goToLine: 'Mod+L',
    goToSymbol: 'Mod+O',
    selectNextOccurrence: 'Alt+J',
    unselectLastOccurrence: 'Shift+Alt+J',
    findInProject: 'Mod+H',
    replaceInFile: 'Mod+F',
    toggleComment: 'Mod+/',
    reindent: 'Mod+I',
    reopenClosedTab: 'Mod+Shift+T',
    splitRight: null,
  },
  vscode: {
    goToFile: 'Mod+P',
    save: 'Mod+S',
    closeTab: 'Mod+W',
    toggleSidebar: 'Mod+Shift+E',
    promptLibrary: 'Mod+Shift+P',
    runActive: 'Mod+F5',
    stop: 'Shift+F5',
    goToLine: 'Mod+G',
    goToSymbol: 'Mod+Shift+O',
    selectNextOccurrence: 'Mod+D',
    unselectLastOccurrence: 'Mod+U',
    findInProject: 'Mod+Shift+F',
    replaceInFile: 'Mod+H',
    toggleComment: 'Mod+/',
    reindent: 'Mod+Alt+I',
    reopenClosedTab: 'Mod+Shift+T',
    splitRight: 'Mod+\\',
  },
};

const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', init);

/** Teclas do terminal (Ctrl+letra) que as ações de editor podem usar, pois só disparam com o editor em foco. */
const TERMINAL_CTRL_KEYS = ['c', 'd', 'z', 'b', 'm', '['];

/** Regra das teclas que o terminal ou o sistema precisam; ações de EDITOR_ONLY_ACTIONS escapam só do ramo Ctrl+letra. */
const reserved = (action: AppAction, chord: string): boolean => {
  const c = parseChord(chord);
  const k = c.key.toLowerCase();
  const editorOnly = (EDITOR_ONLY_ACTIONS as readonly string[]).includes(action);
  if (!editorOnly && c.mod && !c.shift && !c.alt && TERMINAL_CTRL_KEYS.includes(k)) return true;
  if ((c.mod || c.alt) && /^[0-9]$/.test(k)) return true;
  if (k.startsWith('arrow') || ['up', 'down', 'left', 'right'].includes(k)) return true;
  if (c.alt && ['f4', 'tab'].includes(k)) return true;
  if (['delete', 'del', 'audiovolumeup', 'audiovolumedown', 'mediaplaypause'].includes(k)) return true;
  return false;
};

describe('keymap tables', () => {
  it('has the four maps with the seventeen actions', () => {
    expect(Object.keys(KEYMAPS).sort()).toEqual([...KEYMAP_IDS].sort());
    expect([...ACTIONS].sort()).toEqual(
      [
        'closeTab',
        'findInProject',
        'goToFile',
        'goToLine',
        'goToSymbol',
        'promptLibrary',
        'reindent',
        'reopenClosedTab',
        'replaceInFile',
        'runActive',
        'save',
        'selectNextOccurrence',
        'splitRight',
        'stop',
        'toggleComment',
        'toggleSidebar',
        'unselectLastOccurrence',
      ].sort(),
    );
    for (const id of KEYMAP_IDS) {
      expect(Object.keys(KEYMAPS[id]).sort()).toEqual([...ACTIONS].sort());
    }
  });

  it.each([...KEYMAP_IDS])('the %s map matches the research table', (id) => {
    expect(KEYMAPS[id]).toEqual(TABLE[id]);
  });

  it('keeps the shortcuts the app already had in the Windows map', () => {
    expect(KEYMAPS.windows).toMatchObject({
      goToFile: 'Mod+P',
      save: 'Mod+S',
      closeTab: 'Mod+W',
      toggleSidebar: 'Mod+Shift+B',
      promptLibrary: 'Mod+Shift+P',
    });
  });

  it('never repeats a key inside one map', () => {
    for (const id of KEYMAP_IDS) {
      const keys = Object.values(KEYMAPS[id]).filter((k): k is string => k !== null);
      expect(new Set(keys.map((k) => k.toLowerCase())).size).toBe(keys.length);
    }
  });

  it('never takes the keys the terminal needs or the system reserves', () => {
    for (const id of KEYMAP_IDS) {
      for (const action of ACTIONS) {
        const chord = KEYMAPS[id][action];
        if (chord !== null) expect(reserved(action, chord), `${id}/${action}: ${chord}`).toBe(false);
      }
    }
  });

  it('lets only editor-only actions use Ctrl+letter keys of the terminal', () => {
    expect(reserved('save', 'Mod+D')).toBe(true);
    expect(reserved('findInProject', 'Mod+D')).toBe(true);
    expect(reserved('selectNextOccurrence', 'Mod+D')).toBe(false);
    expect(reserved('toggleComment', 'Mod+/')).toBe(false);
    expect(reserved('selectNextOccurrence', 'Mod+1')).toBe(true);
    expect(reserved('reindent', 'Alt+F4')).toBe(true);
    for (const id of KEYMAP_IDS) {
      for (const action of ACTIONS) {
        const chord = KEYMAPS[id][action];
        if (chord === null || (EDITOR_ONLY_ACTIONS as readonly string[]).includes(action)) continue;
        const c = parseChord(chord);
        const ctrlTerminalKey = c.mod && !c.shift && !c.alt && TERMINAL_CTRL_KEYS.includes(c.key.toLowerCase());
        expect(ctrlTerminalKey, `${id}/${action}: ${chord}`).toBe(false);
      }
    }
  });
});

describe('parseChord and chordMatches', () => {
  it('parses modifiers and the key', () => {
    expect(parseChord('Mod+Shift+F12')).toEqual({ mod: true, shift: true, alt: false, key: 'F12' });
    expect(parseChord('Shift+F10')).toEqual({ mod: false, shift: true, alt: false, key: 'F10' });
    expect(parseChord('Mod+P')).toEqual({ mod: true, shift: false, alt: false, key: 'P' });
  });

  it('Mod is Ctrl on Windows/Linux and Cmd on macOS', () => {
    const ctrlP = key({ key: 'p', ctrlKey: true });
    const cmdP = key({ key: 'p', metaKey: true });
    expect(chordMatches('Mod+P', ctrlP, false)).toBe(true);
    expect(chordMatches('Mod+P', cmdP, false)).toBe(false);
    expect(chordMatches('Mod+P', cmdP, true)).toBe(true);
    expect(chordMatches('Mod+P', ctrlP, true)).toBe(false);
  });

  it('is case-insensitive for letters and exact for the other modifiers', () => {
    expect(chordMatches('Mod+Shift+P', key({ key: 'P', ctrlKey: true, shiftKey: true }), false)).toBe(true);
    expect(chordMatches('Mod+P', key({ key: 'P', ctrlKey: true, shiftKey: true }), false)).toBe(false);
    expect(chordMatches('Mod+Shift+P', key({ key: 'p', ctrlKey: true }), false)).toBe(false);
    expect(chordMatches('Mod+P', key({ key: 'p', ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(chordMatches('Shift+F10', key({ key: 'F10', shiftKey: true }), false)).toBe(true);
    expect(chordMatches('Shift+F10', key({ key: 'F10', shiftKey: true, ctrlKey: true }), false)).toBe(false);
    expect(chordMatches('Mod+F5', key({ key: 'F5', ctrlKey: true }), false)).toBe(true);
  });

  it('resolves the action of an event in a map', () => {
    expect(actionFor('intellij', key({ key: 'N', ctrlKey: true, shiftKey: true }), false)).toBe('goToFile');
    expect(actionFor('windows', key({ key: 'N', ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(actionFor('windows', key({ key: 'p', ctrlKey: true }), false)).toBe('goToFile');
    expect(actionFor('windows', key({ key: 'c', ctrlKey: true }), false)).toBeNull();
    expect(actionFor('eclipse', key({ key: 'b', ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });
});

describe('shortcutLabel', () => {
  it('writes the key of the action in the map', () => {
    expect(shortcutLabel('windows', 'goToFile', false)).toBe('Ctrl+P');
    expect(shortcutLabel('intellij', 'goToFile', false)).toBe('Ctrl+Shift+N');
    expect(shortcutLabel('intellij', 'runActive', false)).toBe('Shift+F10');
  });

  it('uses Cmd on macOS', () => {
    expect(shortcutLabel('windows', 'save', true)).toBe('Cmd+S');
    expect(formatChord('Mod+Shift+B', true)).toBe('Cmd+Shift+B');
  });

  it('is null when the map has no key for the action', () => {
    expect(shortcutLabel('eclipse', 'toggleSidebar', false)).toBeNull();
  });
});
