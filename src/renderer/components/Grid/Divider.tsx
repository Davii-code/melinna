import type { PointerEvent as ReactPointerEvent } from 'react';
import { MIN_TRACK_FRACTION, moveDivider } from '../../../core/layout/custom';
import type { Area } from '../../../core/layout/types';
import type { CustomGrid } from '../../../shared/ipc-contract';

export interface DividersProps {
  grid: CustomGrid;
  area: Area;
  /** Proporções ao vivo durante o arrasto. */
  onPreview: (grid: CustomGrid) => void;
  /** Proporções finais, ao soltar. */
  onCommit: (grid: CustomGrid) => void;
}

function boundaries(tracks: readonly number[], total: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const t of tracks.slice(0, -1)) {
    acc += t;
    out.push(Math.round(acc * total));
  }
  return out;
}

/** Divisórias arrastáveis entre as colunas e as linhas da grade personalizada. */
export function Dividers({ grid, area, onPreview, onCommit }: DividersProps) {
  const start = (axis: 'col' | 'row', index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const origin = axis === 'col' ? e.clientX : e.clientY;
    const total = Math.max(1, axis === 'col' ? area.width : area.height);
    const base = grid;
    const at = (ev: PointerEvent) => {
      const delta = ((axis === 'col' ? ev.clientX : ev.clientY) - origin) / total;
      return moveDivider(base, axis, index, delta, MIN_TRACK_FRACTION);
    };
    const move = (ev: PointerEvent) => onPreview(at(ev));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit(at(ev));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <>
      {boundaries(grid.columns, area.width).map((x, i) => (
        <div
          key={`c${i}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={`Divisória entre as colunas ${i + 1} e ${i + 2}`}
          className="divider divider-col"
          data-testid={`divider-col-${i}`}
          style={{ left: x, top: 0, height: area.height }}
          onPointerDown={start('col', i)}
        />
      ))}
      {boundaries(grid.rows, area.height).map((y, i) => (
        <div
          key={`r${i}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Divisória entre as linhas ${i + 1} e ${i + 2}`}
          className="divider divider-row"
          data-testid={`divider-row-${i}`}
          style={{ top: y, left: 0, width: area.width }}
          onPointerDown={start('row', i)}
        />
      ))}
    </>
  );
}
