import { useEffect, useRef, useState, type ReactNode } from 'react';
import { computeAuto } from '../../../core/layout/auto';
import { computeCustom, fitGrid } from '../../../core/layout/custom';
import { computeSidebar } from '../../../core/layout/sidebar';
import { computeSpotlight } from '../../../core/layout/spotlight';
import { computeRegions, defaultRegions, regionGrid, type RegionState } from '../../../core/layout/regions';
import { minPanelSize, type Area, type LayoutResult } from '../../../core/layout/types';
import type { CustomGrid, LayoutMode } from '../../../shared/ipc-contract';
import { Dividers } from './Divider';
import { useReorderDrag } from './useReorderDrag';

export const CELL_PX = { width: 8, height: 17 };
export const PANEL_CHROME_PX = { width: 12, height: 42 };
export const MIN_PANEL = minPanelSize(CELL_PX, PANEL_CHROME_PX);
const DEFAULT_CUSTOM: CustomGrid = { columns: [1], rows: [1], cells: {} };

export interface GridProps {
  ids: string[];
  renderPanel: (id: string, visible: boolean) => ReactNode;
  observeResize: (el: HTMLElement, fn: () => void) => () => void;
  mode?: LayoutMode;
  focusedId?: string | null;
  custom?: CustomGrid;
  editorIds?: string[];
  regions?: RegionState | undefined;
  editorFocus?: boolean;
  hidden?: boolean;
  onRegionsChange?: (regions: RegionState) => void;
  onRelayout?: (visibleIds: string[]) => void;
  onCustomChange?: (grid: CustomGrid) => void;
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
  editorIds = [],
  regions = defaultRegions(),
  editorFocus = false,
  hidden = false,
  onRegionsChange,
  onRelayout,
  onCustomChange,
  onReorder,
}: GridProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Area>({ width: 0, height: 0 });
  const [preview, setPreview] = useState<CustomGrid | null>(null);
  const [regionPreview, setRegionPreview] = useState<RegionState | null>(null);
  const drag = useReorderDrag(onReorder);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth && el.clientHeight) setArea({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    return observeResize(el, measure);
  }, [observeResize]);

  const regional = editorFocus || mode === 'terminals' || mode === 'development';
  const terminalIds = ids.filter((id) => !editorIds.includes(id));
  const savedRegions = regionPreview ?? regions;
  const geometry = {
    ...savedRegions,
    terminals: regionGrid(savedRegions.terminals, terminalIds),
    editors: regionGrid(savedRegions.editors, editorIds),
  };
  const presentation = editorFocus ? 'editor' : mode === 'terminals' ? 'terminals' : 'development';
  const resizable = mode === 'auto' && onCustomChange !== undefined;
  const effectiveMode: LayoutMode = resizable ? 'custom' : mode;
  const grid = preview ?? (resizable ? fitGrid(custom, ids) : custom);
  const regionalWidth = Math.max(
    area.width,
    MIN_PANEL.width *
      Math.max(
        presentation === 'editor' ? 1 : 1 / Math.min(...geometry.terminals.columns),
        presentation === 'terminals' ? 1 : 1 / Math.min(...geometry.editors.columns),
      ),
  );
  const regionalArea = { ...area, width: regionalWidth };
  const layout = regional
    ? computeRegions(terminalIds, editorIds, regionalArea, geometry, presentation)
    : computeLayout(effectiveMode, ids, area, focusedId, grid);
  const visibleIds = hidden ? [] : layout.rects.map((r) => r.id);
  const visibleKey = mode + '|' + editorFocus + '|' + visibleIds.join(',');
  const relayoutRef = useRef(onRelayout);
  relayoutRef.current = onRelayout;
  useEffect(() => {
    relayoutRef.current?.(visibleKey.split('|')[2]?.split(',').filter(Boolean) ?? []);
  }, [visibleKey]);

  const terminalRects = layout.rects.filter((r) => terminalIds.includes(r.id));
  const terminalHeight = Math.max(0, ...terminalRects.map((r) => r.y + r.height));
  const editorHeight = layout.contentHeight - terminalHeight;
  const changeRegions = (next: RegionState, commit: boolean) => {
    if (commit) {
      setRegionPreview(null);
      onRegionsChange?.(next);
    } else setRegionPreview(next);
  };
  const renderDividers = (key: 'terminals' | 'editors', top: number, height: number) => (
    <div className="region-dividers" style={{ top, width: regionalWidth, height }}>
      <Dividers
        grid={geometry[key]}
        minColumnFraction={MIN_PANEL.width / regionalWidth}
        minRowFraction={(key === 'terminals' ? 200 : 240) / Math.max(1, height)}
        area={{ width: regionalWidth, height }}
        onPreview={(g) => changeRegions({ ...geometry, [key]: g }, false)}
        onCommit={(g) => changeRegions({ ...geometry, [key]: g }, true)}
      />
    </div>
  );

  return (
    <div
      ref={ref}
      className={
        'grid grid-' +
        mode +
        (layout.overflow || regional ? ' grid-scroll' : '') +
        (hidden ? ' workspace-hidden' : '')
      }
      data-testid="grid"
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
    >
      <div
        className="grid-content"
        style={{ height: layout.contentHeight, width: regional ? regionalWidth : undefined }}
      >
        {ids.map((id) => {
          const r = layout.rects.find((rect) => rect.id === id);
          const visible = visibleIds.includes(id);
          return (
            <div
              key={id}
              className={'grid-cell' + (r ? '' : ' grid-hidden')}
              data-testid={'cell-' + id}
              aria-hidden={!visible || undefined}
              inert={!visible || undefined}
              style={r ? { left: r.x, top: r.y, width: r.width, height: r.height } : undefined}
              {...drag(id)}
            >
              {renderPanel(id, visible)}
            </div>
          );
        })}
        {visibleIds.length === 0 && !hidden && (
          <div className="grid-empty-message">
            {mode === 'terminals'
              ? 'Nenhum terminal aberto. Crie uma tarefa ou escolha outro layout para voltar ao editor.'
              : 'Nenhum painel aberto. Crie uma tarefa ou abra uma execução pela árvore.'}
          </div>
        )}
        {!regional && effectiveMode === 'custom' && onCustomChange && (
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
        {regional && onRegionsChange && (
          <>
            {terminalRects.length > 0 && renderDividers('terminals', 0, terminalHeight)}
            {presentation !== 'terminals' &&
              editorIds.length > 0 &&
              renderDividers('editors', terminalHeight, editorHeight)}
            {terminalRects.length > 0 &&
              editorHeight > 0 &&
              editorIds.length > 0 &&
              presentation === 'development' && (
                <Dividers
                  grid={{
                    columns: [1],
                    rows: [terminalHeight / layout.contentHeight, editorHeight / layout.contentHeight],
                    cells: {},
                  }}
                  area={{ width: regionalWidth, height: layout.contentHeight }}
                  onPreview={(g) =>
                    changeRegions(
                      { ...geometry, terminalFraction: Math.max(0.15, Math.min(0.85, g.rows[0] ?? 0.5)) },
                      false,
                    )
                  }
                  onCommit={(g) =>
                    changeRegions(
                      { ...geometry, terminalFraction: Math.max(0.15, Math.min(0.85, g.rows[0] ?? 0.5)) },
                      true,
                    )
                  }
                />
              )}
          </>
        )}
      </div>
    </div>
  );
}
