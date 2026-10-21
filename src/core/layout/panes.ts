/**
 * Painéis do layout. Vivem aqui (e não na persistência) porque são conceito de layout e o renderer
 * pode importar `src/core/layout` — a fronteira de arquitetura do Princípio IV permite só esta
 * camada do núcleo na interface.
 */

/**
 * Painel da grade. O de terminal usa `id` igual ao `execId` da primeira execução, então as células da
 * grade personalizada, o foco e o arrastar continuam funcionando sem tradução.
 */
export type Pane =
  | { id: string; kind: 'executions'; execIds: string[]; activeIndex: number }
  | { id: string; kind: 'editor'; docs: string[]; activeIndex: number };

export type ExecutionPane = Extract<Pane, { kind: 'executions' }>;
export type EditorPaneModel = Extract<Pane, { kind: 'editor' }>;

export function paneOfExecution(execId: string): ExecutionPane {
  return { id: execId, kind: 'executions', execIds: [execId], activeIndex: 0 };
}

/** Abas do painel, seja de execuções ou de arquivos. */
export function tabsOf(pane: Pane): readonly string[] {
  return pane.kind === 'executions' ? pane.execIds : pane.docs;
}

/** Índice da aba ativa sempre dentro do intervalo válido. */
export function clampActiveIndex(pane: Pane): number {
  const length = tabsOf(pane).length;
  if (length === 0) return 0;
  return Math.max(0, Math.min(pane.activeIndex, length - 1));
}

/** Remove a aba `index`; devolve `null` quando o painel fica vazio e deve sair da grade. */
export function paneWithoutTab(pane: Pane, index: number): Pane | null {
  const active = clampActiveIndex(pane);
  if (pane.kind === 'executions') {
    const execIds = pane.execIds.filter((_, i) => i !== index);
    if (execIds.length === 0) return null;
    return { ...pane, execIds, activeIndex: Math.min(active, execIds.length - 1) };
  }
  const docs = pane.docs.filter((_, i) => i !== index);
  if (docs.length === 0) return null;
  return { ...pane, docs, activeIndex: Math.min(active, docs.length - 1) };
}
