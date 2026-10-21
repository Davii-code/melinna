import type { Area, LayoutResult, Rect } from './types';

/** Fração da janela ocupada pela faixa de painéis reduzidos. */
export const STRIP_FRACTION = 0.22;
/** Proporção largura/altura a partir da qual a faixa vai para a direita. */
export const WIDE_RATIO = 1.4;

const EMPTY: LayoutResult = { rects: [], contentHeight: 0, overflow: false };

/** Divide `length` em `n` partes inteiras que somam exatamente `length`. */
export function split(start: number, length: number, n: number): { start: number; size: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const a = Math.round((i * length) / n);
    const b = Math.round(((i + 1) * length) / n);
    return { start: start + a, size: b - a };
  });
}

/** O painel em foco, ou o primeiro quando o foco não está aberto. */
export function focusOf(ids: readonly string[], focused: string | null): string {
  return focused !== null && ids.includes(focused) ? focused : ids[0]!;
}

/**
 * Um painel em foco grande e os demais reduzidos numa faixa: à direita em janela larga, embaixo em janela alta.
 * O painel em foco vem primeiro na lista de retângulos.
 */
export function computeSpotlight(ids: readonly string[], focused: string | null, area: Area): LayoutResult {
  if (ids.length === 0) return EMPTY;
  const main = focusOf(ids, focused);
  if (ids.length === 1) {
    return { rects: [{ id: main, x: 0, y: 0, width: area.width, height: area.height }], contentHeight: area.height, overflow: false };
  }
  const others = ids.filter((id) => id !== main);
  const rects: Rect[] = [];
  if (area.width / Math.max(1, area.height) >= WIDE_RATIO) {
    const stripW = Math.round(area.width * STRIP_FRACTION);
    rects.push({ id: main, x: 0, y: 0, width: area.width - stripW, height: area.height });
    split(0, area.height, others.length).forEach((s, i) =>
      rects.push({ id: others[i]!, x: area.width - stripW, y: s.start, width: stripW, height: s.size }),
    );
  } else {
    const stripH = Math.round(area.height * STRIP_FRACTION);
    rects.push({ id: main, x: 0, y: 0, width: area.width, height: area.height - stripH });
    split(0, area.width, others.length).forEach((s, i) =>
      rects.push({ id: others[i]!, x: s.start, y: area.height - stripH, width: s.size, height: stripH }),
    );
  }
  return { rects, contentHeight: area.height, overflow: false };
}
