import { useEffect, useRef, useState, type ReactNode } from 'react';
import { computeAuto } from '../../../core/layout/auto';
import { minPanelSize, type Area, type LayoutResult } from '../../../core/layout/types';

/** Célula aproximada do terminal (Cascadia Mono 13px) e o cabeçalho do painel. */
export const CELL_PX = { width: 8, height: 17 };
export const PANEL_CHROME_PX = { width: 4, height: 30 };
export const MIN_PANEL = minPanelSize(CELL_PX, PANEL_CHROME_PX);

export interface GridProps {
  ids: string[];
  renderPanel: (id: string) => ReactNode;
  /** Algoritmo de distribuição; o padrão é o modo automático. */
  compute?: (ids: string[], area: Area) => LayoutResult;
  /** Elementos extras sobre a grade (divisórias). */
  overlay?: (area: Area, layout: LayoutResult) => ReactNode;
  observeResize: (el: HTMLElement, fn: () => void) => () => void;
}

export function autoCompute(ids: string[], area: Area): LayoutResult {
  return computeAuto(ids, area, MIN_PANEL);
}

export function Grid({ ids, renderPanel, compute = autoCompute, overlay, observeResize }: GridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Area>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    return observeResize(el, measure);
  }, [observeResize]);

  if (ids.length === 0) {
    return (
      <div className="grid grid-empty" ref={ref} data-testid="grid">
        <p>Nenhum painel aberto. Crie uma tarefa ou abra uma execução pela árvore.</p>
      </div>
    );
  }

  const layout = compute(ids, area);
  return (
    <div className={`grid${layout.overflow ? ' grid-scroll' : ''}`} ref={ref} data-testid="grid">
      <div className="grid-content" style={{ height: layout.contentHeight }}>
        {layout.rects.map((r) => (
          <div
            key={r.id}
            className="grid-cell"
            data-testid={`cell-${r.id}`}
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          >
            {renderPanel(r.id)}
          </div>
        ))}
        {ids
          .filter((id) => !layout.rects.some((r) => r.id === id))
          .map((id) => (
            <div key={id} className="grid-cell grid-hidden" data-testid={`cell-${id}`} aria-hidden="true">
              {renderPanel(id)}
            </div>
          ))}
        {overlay?.(area, layout)}
      </div>
    </div>
  );
}
