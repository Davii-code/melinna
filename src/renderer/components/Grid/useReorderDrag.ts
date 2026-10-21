import type { DragEvent } from 'react';

export const PANEL_MIME = 'application/x-melinna-panel';

export interface ReorderHandlers {
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}

/**
 * Arrastar e soltar painéis pelo cabeçalho: a célula de origem grava o id no `dataTransfer`
 * e a célula de destino chama `onReorder(origem, destino)`.
 */
export function useReorderDrag(onReorder: ((fromId: string, toId: string) => void) | undefined) {
  return (id: string): ReorderHandlers | Record<string, never> => {
    if (!onReorder) return {};
    return {
      onDragStart: (e) => {
        e.dataTransfer.setData(PANEL_MIME, id);
        e.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (e) => {
        if (!Array.from(e.dataTransfer.types).includes(PANEL_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      },
      onDrop: (e) => {
        const from = e.dataTransfer.getData(PANEL_MIME);
        if (!from) return;
        e.preventDefault();
        if (from !== id) onReorder(from, id);
      },
    };
  };
}
