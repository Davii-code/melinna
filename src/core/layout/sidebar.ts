import { focusOf, split } from './spotlight';
import type { Area, LayoutResult, Rect } from './types';

/** Fração da largura ocupada pela coluna de painéis auxiliares. */
export const SIDEBAR_FRACTION = 0.3;

/** Painel principal à esquerda e os demais empilhados numa coluna à direita, em qualquer proporção de janela. */
export function computeSidebar(ids: readonly string[], focused: string | null, area: Area): LayoutResult {
  if (ids.length === 0) return { rects: [], contentHeight: 0, overflow: false };
  const main = focusOf(ids, focused);
  if (main === null) return { rects: [], contentHeight: 0, overflow: false };
  if (ids.length === 1) {
    return { rects: [{ id: main, x: 0, y: 0, width: area.width, height: area.height }], contentHeight: area.height, overflow: false };
  }
  const others = ids.filter((id) => id !== main);
  const colW = Math.round(area.width * SIDEBAR_FRACTION);
  const rects: Rect[] = [{ id: main, x: 0, y: 0, width: area.width - colW, height: area.height }];
  const slots = split(0, area.height, others.length);
  others.forEach((id, i) => {
    const slot = slots[i];
    if (slot) rects.push({ id, x: area.width - colW, y: slot.start, width: colW, height: slot.size });
  });
  return { rects, contentHeight: area.height, overflow: false };
}
