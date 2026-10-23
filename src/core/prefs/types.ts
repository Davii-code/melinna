export type KeymapId = 'windows' | 'intellij' | 'eclipse' | 'vscode';

export const KEYMAP_IDS: readonly KeymapId[] = ['windows', 'intellij', 'eclipse', 'vscode'];

export const DEFAULT_KEYMAP: KeymapId = 'windows';

export const PREFERENCES_FILE_VERSION = 1;

export interface ActiveRunRef {
  groupId: string;
  commandId: string;
}

export interface Preferences {
  keymap: KeymapId;
  activeRun: ActiveRunRef | null;
  /** Arquivo de versão mais nova: as escolhas valem só na sessão. */
  readOnly: boolean;
}

/** Forma gravada em `userData/preferences.json`. */
export interface PreferencesFile {
  version: number;
  keymap: KeymapId;
  activeRun: ActiveRunRef | null;
}

export function isKeymapId(v: unknown): v is KeymapId {
  return typeof v === 'string' && (KEYMAP_IDS as readonly string[]).includes(v);
}
