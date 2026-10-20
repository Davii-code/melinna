import type { Area, LayoutResult, MinSize, Rect } from './types';

function place(ids: readonly string[], cols: number, rowHeight: number, width: number): Rect[] {
  const rects: Rect[] = [];
  const rows = Math.ceil(ids.length / cols);
  for (let r = 0; r < rows; r++) {
    const inRow = ids.slice(r * cols, (r + 1) * cols);
    // a última linha incompleta estica os painéis para ocupar a largura
    const w = width / inRow.length;
    inRow.forEach((id, i) =>
      rects.push({
        id,
        x: Math.round(i * w),
        y: Math.round(r * rowHeight),
        width: Math.round((i + 1) * w) - Math.round(i * w),
        height: Math.round(rowHeight),
      }),
    );
  }
  return rects;
}

/**
 * Distribui 1 a 12 painéis em linhas e colunas sem deixar nenhum abaixo do mínimo.
 * Se não couber, mantém a altura mínima e passa a rolar a grade em vez de encolher.
 */
export function computeAuto(ids: readonly string[], area: Area, min: MinSize): LayoutResult {
  const n = ids.length;
  if (n === 0) return { rects: [], contentHeight: 0, overflow: false };
  let best: { cols: number; score: number } | null = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = area.width / cols;
    const h = area.height / rows;
    if (w < min.width || h < min.height) continue;
    // prefere painéis maiores e, no empate, proporções mais próximas de um terminal (mais largo que alto)
    const score = Math.min(w / min.width, h / min.height) - Math.abs(Math.log(w / h / 1.6)) * 0.01;
    if (!best || score > best.score) best = { cols, score };
  }
  if (best) {
    const rows = Math.ceil(n / best.cols);
    return {
      rects: place(ids, best.cols, area.height / rows, area.width),
      contentHeight: area.height,
      overflow: false,
    };
  }
  const cols = Math.max(1, Math.min(n, Math.floor(area.width / min.width)));
  const rows = Math.ceil(n / cols);
  const rowHeight = Math.max(min.height, area.height / rows);
  const contentHeight = Math.round(rowHeight * rows);
  return {
    rects: place(ids, cols, rowHeight, area.width),
    contentHeight,
    overflow: contentHeight > area.height,
  };
}
