import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  clampSidebar,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SidebarResizer,
  storedSidebarWidth,
  storeSidebarWidth,
} from '../../../src/renderer/components/SidebarResizer';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('sidebar width', () => {
  it('clamps between the minimum and the maximum', () => {
    expect(clampSidebar(50)).toBe(SIDEBAR_MIN);
    expect(clampSidebar(5000)).toBe(SIDEBAR_MAX);
    expect(clampSidebar(321.6)).toBe(322);
  });

  it('remembers the width and falls back to the default', () => {
    const storage = memoryStorage();
    expect(storedSidebarWidth(storage)).toBe(SIDEBAR_DEFAULT);
    storeSidebarWidth(360, storage);
    expect(storedSidebarWidth(storage)).toBe(360);
    expect(storedSidebarWidth(memoryStorage({ 'melinna.sidebarWidth': 'abc' }))).toBe(SIDEBAR_DEFAULT);
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(storedSidebarWidth(broken)).toBe(SIDEBAR_DEFAULT);
  });
});

describe('SidebarResizer', () => {
  it('drags to resize, previewing while moving and committing on release', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<SidebarResizer width={280} onChange={onChange} onCommit={onCommit} />);
    fireEvent.pointerDown(screen.getByRole('separator', { name: 'Largura da barra lateral' }), {
      clientX: 280,
    });
    fireEvent.pointerMove(window, { clientX: 330 });
    expect(onChange).toHaveBeenLastCalledWith(330);
    fireEvent.pointerUp(window, { clientX: 2000 });
    expect(onCommit).toHaveBeenCalledWith(SIDEBAR_MAX);
  });

  it('resizes with the arrow keys', () => {
    const onCommit = vi.fn();
    render(<SidebarResizer width={280} onChange={vi.fn()} onCommit={onCommit} />);
    const handle = screen.getByTestId('sidebar-resizer');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual([296, 264]);
  });
});
