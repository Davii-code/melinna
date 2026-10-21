import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Grid } from '../../../src/renderer/components/Grid/Grid';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import type { CustomGrid } from '../../../src/shared/ipc-contract';
import { fakeApi } from '../../support/fake-api';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 });
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

const observe = () => () => undefined;
const ids = ['a', 'b', 'c', 'd'];
const cell = (id: string) => screen.getByTestId(`cell-${id}`).style;

describe('Grid modes', () => {
  it('spotlight makes the focused panel the largest', () => {
    render(<Grid ids={ids} mode="spotlight" focusedId="c" renderPanel={() => null} observeResize={observe} />);
    expect(parseFloat(cell('c').width)).toBeGreaterThan(1000);
    expect(cell('c').left).toBe('0px');
    expect(parseFloat(cell('a').width)).toBeLessThan(400);
  });

  it('sidebar keeps the main panel and stacks the others in a column', () => {
    render(<Grid ids={ids} mode="sidebar" focusedId="a" renderPanel={() => null} observeResize={observe} />);
    expect(cell('b').left).toBe(cell('c').left);
    expect(parseFloat(cell('a').width)).toBeGreaterThan(parseFloat(cell('b').width));
  });

  it('custom uses the saved grid fractions', () => {
    const custom: CustomGrid = {
      columns: [0.25, 0.75],
      rows: [1],
      cells: {
        a: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        b: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      },
    };
    render(<Grid ids={['a', 'b']} mode="custom" custom={custom} renderPanel={() => null} observeResize={observe} />);
    expect(cell('a').width).toBe('400px');
    expect(cell('b').left).toBe('400px');
  });

  it('reports the visible panels after every mode or focus change so terminals resend their size', () => {
    const onRelayout = vi.fn();
    const props = { ids, renderPanel: () => null, observeResize: observe, onRelayout };
    const { rerender } = render(<Grid {...props} mode="auto" />);
    expect(onRelayout).toHaveBeenLastCalledWith(ids);
    rerender(<Grid {...props} mode="spotlight" focusedId="b" />);
    expect(onRelayout).toHaveBeenCalledTimes(2);
    expect(onRelayout.mock.calls[1]?.[0]).toEqual(['b', 'a', 'c', 'd']);
    rerender(<Grid {...props} mode="spotlight" focusedId="b" />);
    expect(onRelayout).toHaveBeenCalledTimes(2);
    rerender(<Grid {...props} mode="spotlight" focusedId="d" />);
    expect(onRelayout).toHaveBeenCalledTimes(3);
  });
});

describe('layout store persistence', () => {
  function storeWithApi() {
    const api = fakeApi();
    const store = createLayoutStore(api, (fn) => {
      fn();
      return () => undefined;
    });
    for (const id of ids) store.open(id);
    api.layout.set.mockClear();
    return { api, store };
  }

  it('saves mode changes through layout.set', async () => {
    const { api, store } = storeWithApi();
    act(() => store.setMode('spotlight'));
    await store.flush();
    expect(api.layout.set).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'spotlight' }));
  });

  it('switching to custom creates a grid with a cell per open panel', () => {
    const { store } = storeWithApi();
    store.setMode('custom');
    const s = store.get();
    expect(Object.keys(s.custom.cells).sort()).toEqual(ids);
    expect(s.custom.columns).toHaveLength(2);
  });

  it('reorders open panels, or swaps cells in custom mode, and saves', () => {
    const { api, store } = storeWithApi();
    store.reorder('a', 'c');
    expect(store.get().openExecutionIds).toEqual(['b', 'c', 'a', 'd']);
    store.setMode('custom');
    const before = store.get().custom.cells;
    store.reorder('b', 'd');
    expect(store.get().custom.cells.b).toEqual(before.d);
    expect(store.get().custom.cells.d).toEqual(before.b);
    expect(api.layout.set).toHaveBeenCalled();
  });

  it('saves custom grids and cycles the focus', () => {
    const { store } = storeWithApi();
    store.focus('a');
    store.cycleFocus(1);
    expect(store.get().focusedExecutionId).toBe('b');
    store.cycleFocus(-1);
    store.cycleFocus(-1);
    expect(store.get().focusedExecutionId).toBe('d');
    const grid: CustomGrid = { columns: [0.4, 0.6], rows: [1], cells: {} };
    store.setCustom(grid);
    expect(store.get().custom).toEqual(grid);
  });
});
