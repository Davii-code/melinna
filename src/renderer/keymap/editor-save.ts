const savers = new Map<string, () => void>();

/** O painel de editor diz como salvar a aba ativa dele; devolve quem desfaz o registro. */
export function registerEditorSaver(paneId: string, save: () => void): () => void {
  savers.set(paneId, save);
  return () => {
    if (savers.get(paneId) === save) savers.delete(paneId);
  };
}

/** Salva a aba ativa do painel de editor; `false` se o painel não é um editor registrado. */
export function saveEditor(paneId: string | null): boolean {
  const save = paneId === null ? undefined : savers.get(paneId);
  if (!save) return false;
  save();
  return true;
}

const closers = new Map<string, () => void>();
/** Keyboard close uses the same dirty-file confirmation as the tab close button. */
export function registerEditorCloser(paneId: string, close: () => void): () => void {
  closers.set(paneId, close);
  return () => {
    if (closers.get(paneId) === close) closers.delete(paneId);
  };
}
export function closeEditorTab(paneId: string): boolean {
  const close = closers.get(paneId);
  if (!close) return false;
  close();
  return true;
}
