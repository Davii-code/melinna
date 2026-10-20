export interface Rect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Area {
  width: number;
  height: number;
}

/** Tamanho mínimo de um painel em pixels (40 colunas × 10 linhas de terminal, mais o cabeçalho). */
export interface MinSize {
  width: number;
  height: number;
}

export interface LayoutResult {
  rects: Rect[];
  /** Altura total do conteúdo; maior que a área quando há rolagem. */
  contentHeight: number;
  overflow: boolean;
}

export const MIN_COLS = 40;
export const MIN_ROWS = 10;

export function minPanelSize(
  cell: { width: number; height: number },
  chrome: { width: number; height: number },
): MinSize {
  return {
    width: Math.ceil(MIN_COLS * cell.width + chrome.width),
    height: Math.ceil(MIN_ROWS * cell.height + chrome.height),
  };
}
