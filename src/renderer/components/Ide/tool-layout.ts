export type ToolTab = 'language' | 'debug' | 'http' | 'database';

export interface ToolLayout {
  open: boolean;
  tab: ToolTab;
  height: number;
}

export const DEFAULT_TOOL_LAYOUT: Readonly<ToolLayout> = {
  open: false,
  tab: 'language',
  height: 280,
};

export const TOOL_LAYOUT_KEY = 'melinna.ide.layout.v1';
const TOOL_TABS: readonly ToolTab[] = ['language', 'debug', 'http', 'database'];
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 600;

function normalize(value: unknown): ToolLayout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ...DEFAULT_TOOL_LAYOUT };
  const layout = value as Record<string, unknown>;
  return {
    open: typeof layout.open === 'boolean' ? layout.open : DEFAULT_TOOL_LAYOUT.open,
    tab: TOOL_TABS.includes(layout.tab as ToolTab) ? (layout.tab as ToolTab) : DEFAULT_TOOL_LAYOUT.tab,
    height:
      typeof layout.height === 'number' && Number.isFinite(layout.height)
        ? Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, layout.height)))
        : DEFAULT_TOOL_LAYOUT.height,
  };
}

/** A ferramenta ativa e o tamanho do painel na última sessão. */
export function readToolLayout(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): ToolLayout {
  try {
    const raw = storage?.getItem(TOOL_LAYOUT_KEY);
    if (raw === null || raw === undefined) return { ...DEFAULT_TOOL_LAYOUT };
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_TOOL_LAYOUT };
  }
}

/** Persiste somente o estado visual; se o armazenamento falhar, a tela continua usando o estado em memória. */
export function writeToolLayout(storage: Pick<Storage, 'setItem'> | undefined, layout: ToolLayout): void {
  try {
    storage?.setItem(TOOL_LAYOUT_KEY, JSON.stringify(normalize(layout)));
  } catch {
    // Armazenamento indisponível: a seleção atual continua somente na sessão.
  }
}
