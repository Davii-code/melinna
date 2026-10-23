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
