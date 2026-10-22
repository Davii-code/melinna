import { useEffect, useRef, useState, type ReactNode } from 'react';
import { computeAuto } from '../../../core/layout/auto';
import { computeCustom, fitGrid } from '../../../core/layout/custom';
import { computeSidebar } from '../../../core/layout/sidebar';
import { computeSpotlight } from '../../../core/layout/spotlight';
import { minPanelSize, type Area, type LayoutResult } from '../../../core/layout/types';
import type { CustomGrid, LayoutMode } from '../../../shared/ipc-contract';
import { Dividers } from './Divider';
import { useReorderDrag } from './useReorderDrag';

/** Célula aproximada do terminal (Cascadia Mono 13px) e o cabeçalho do painel. */
export const CELL_PX = { width: 8, height: 17 };
export const PANEL_CHROME_PX = { width: 4, height: 30 };
export const MIN_PANEL = minPanelSize(CELL_PX, PANEL_CHROME_PX);

const DEFAULT_CUSTOM: CustomGrid = { columns: [1], rows: [1], cells: {} };

export interface GridProps {
  ids: string[];
  renderPanel: (id: string) => ReactNode;
  observeResize: (el: HTMLElement, fn: () => void) => () => void;
  mode?: LayoutMode;
  focusedId?: string | null;
  custom?: CustomGrid;
  /** Painéis visíveis após mudança de modo, foco ou ordem: os terminais reenviam o tamanho ao PTY. */
  onRelayout?: (visibleIds: string[]) => void;
  /** Proporções finais da grade personalizada após arrastar uma divisória. */
  onCustomChange?: (grid: CustomGrid) => void;
  /** Arrastar e soltar um painel sobre outro. */
  onReorder?: (fromId: string, toId: string) => void;
}

export function computeLayout(
  mode: LayoutMode,
  ids: string[],
  area: Area,
  focusedId: string | null,
  custom: CustomGrid,
): LayoutResult {
  switch (mode) {
    case 'spotlight':
      return computeSpotlight(ids, focusedId, area);
    case 'sidebar':
      return computeSidebar(ids, focusedId, area);
    case 'custom':
      return computeCustom(ids, custom, area);
    default:
      return computeAuto(ids, area, MIN_PANEL);
  }
}

export function Grid({
  ids,
  renderPanel,
  observeResize,
  mode = 'auto',
  focusedId = null,
  custom = DEFAULT_CUSTOM,
  onRelayout,
  onCustomChange,
  onReorder,
}: GridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Area>({ width: 0, height: 0 });
  const [preview, setPreview] = useState<CustomGrid | null>(null);
  const drag = useReorderDrag(onReorder);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setArea({ width: el.clientWidth, height: el.clientHeight });
    measure();
    return observeResize(el, measure);
  }, [observeResize]);

  // No automático com quem guarde as proporções, a grade é redimensionável: divisórias entre os painéis.
  const resizable = mode === 'auto' && onCustomChange !== undefined;
  const effectiveMode: LayoutMode = resizable ? 'custom' : mode;
  const grid = preview ?? (resizable ? fitGrid(custom, ids) : custom);
  const layout = computeLayout(effectiveMode, ids, area, focusedId, grid);
  const visibleKey = `${mode}|${layout.rects.map((r) => r.id).join(',')}`;
  const relayoutRef = useRef(onRelayout);
  relayoutRef.current = onRelayout;
  useEffect(() => {
    const visible = visibleKey.split('|')[1];
    relayoutRef.current?.(visible ? visible.split(',') : []);
  }, [visibleKey]);

  if (ids.length === 0) {
    return (
      <div className="grid grid-empty" ref={ref} data-testid="grid">
        <p>Nenhum painel aberto. Crie uma tarefa ou abra uma execução pela árvore.</p>
      </div>
    );
  }

  return (
    <div className={`grid grid-${mode}${layout.overflow ? ' grid-scroll' : ''}`} ref={ref} data-testid="grid">
      <div className="grid-content" style={{ height: layout.contentHeight }}>
        {layout.rects.map((r) => (
          <div
            key={r.id}
            className="grid-cell"
            data-testid={`cell-${r.id}`}
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
            {...drag(r.id)}
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
        {effectiveMode === 'custom' && onCustomChange && (
          <Dividers
            grid={grid}
            area={area}
            onPreview={setPreview}
            onCommit={(g) => {
              setPreview(null);
              onCustomChange(g);
            }}
          />
        )}
      </div>
    </div>
  );
}
