export type SidebarPanel = 'workspaces' | 'files' | 'commit';

const SIDEBAR_PANEL_KEY = 'melinna.sidebarPanel';
const ACTIVE_WORKSPACE_KEY = 'melinna.activeWorkspace';
const SIDEBAR_PANELS: readonly SidebarPanel[] = ['workspaces', 'files', 'commit'];

/** Painel ativo da barra lateral na última vez; sem valor válido, o de workspaces. */
export function storedSidebarPanel(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): SidebarPanel {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SIDEBAR_PANEL_KEY) ?? null;
  } catch {
    // armazenamento indisponível: fica o painel padrão
  }
  return SIDEBAR_PANELS.find((panel) => panel === raw) ?? 'workspaces';
}

export function storeSidebarPanel(
  panel: SidebarPanel,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(SIDEBAR_PANEL_KEY, panel);
  } catch {
    // armazenamento indisponível: o painel vale só nesta sessão
  }
}

/** Workspace ativo na última vez; sem valor, null. */
export function storedActiveWorkspace(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): string | null {
  try {
    const raw = storage?.getItem(ACTIVE_WORKSPACE_KEY) ?? null;
    return raw ? raw : null;
  } catch {
    return null;
  }
}

export function storeActiveWorkspace(
  id: string | null,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage,
): void {
  try {
    if (id === null) storage?.removeItem(ACTIVE_WORKSPACE_KEY);
    else storage?.setItem(ACTIVE_WORKSPACE_KEY, id);
  } catch {
    // armazenamento indisponível: o workspace ativo vale só nesta sessão
  }
}
