import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Grid, MIN_PANEL } from '../../../src/renderer/components/Grid/Grid';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 });
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

const observe = () => () => undefined;

describe('Grid (auto)', () => {
  it('shows an empty state without panels', () => {
    render(<Grid ids={[]} renderPanel={() => null} observeResize={observe} />);
    expect(screen.getByText(/Nenhum painel aberto/)).toBeTruthy();
  });

  it('positions every open panel with at least the minimum size', () => {
    const ids = ['a', 'b', 'c', 'd'];
    render(<Grid ids={ids} renderPanel={(id) => <span>painel {id}</span>} observeResize={observe} />);
    for (const id of ids) {
      const cell = screen.getByTestId(`cell-${id}`);
      expect(parseFloat(cell.style.width)).toBeGreaterThanOrEqual(MIN_PANEL.width - 1);
      expect(parseFloat(cell.style.height)).toBeGreaterThanOrEqual(MIN_PANEL.height - 1);
      expect(cell.textContent).toBe(`painel ${id}`);
    }
  });

  it('scrolls when 12 panels do not fit', () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 });
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    render(<Grid ids={ids} renderPanel={() => null} observeResize={observe} />);
    expect(screen.getByTestId('grid').className).toContain('grid-scroll');
  });
});
