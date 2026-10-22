import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 640;
export const SIDEBAR_DEFAULT = 280;
const STORAGE_KEY = 'melinna.sidebarWidth';
const KEY_STEP = 16;

export function clampSidebar(width: number): number {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
}

/** Largura salva da barra lateral; sem valor válido, a padrão. */
export function storedSidebarWidth(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): number {
  let raw = NaN;
  try {
    raw = Number(storage?.getItem(STORAGE_KEY));
  } catch {
    // armazenamento indisponível: fica a largura padrão
  }
  return Number.isFinite(raw) && raw > 0 ? clampSidebar(raw) : SIDEBAR_DEFAULT;
}

export function storeSidebarWidth(
  width: number,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(STORAGE_KEY, String(clampSidebar(width)));
  } catch {
    // armazenamento indisponível: a largura vale só nesta sessão
  }
}

export interface SidebarResizerProps {
  width: number;
  /** Largura ao vivo durante o arrasto e com as setas. */
  onChange: (width: number) => void;
  /** Largura final, ao soltar (para gravar). */
  onCommit: (width: number) => void;
}

/** Divisória arrastável entre a barra lateral e a área de painéis; ←/→ também ajustam. */
export function SidebarResizer({ width, onChange, onCommit }: SidebarResizerProps) {
  const start = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const origin = e.clientX;
    const base = width;
    const at = (ev: PointerEvent) => clampSidebar(base + ev.clientX - origin);
    const move = (ev: PointerEvent) => onChange(at(ev));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onCommit(at(ev));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = clampSidebar(width + (e.key === 'ArrowRight' ? KEY_STEP : -KEY_STEP));
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da barra lateral"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      className="sidebar-resizer"
      data-testid="sidebar-resizer"
      onPointerDown={start}
      onKeyDown={onKey}
    />
  );
}
