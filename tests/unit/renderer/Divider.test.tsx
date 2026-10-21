import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dividers } from '../../../src/renderer/components/Grid/Divider';
import { Grid } from '../../../src/renderer/components/Grid/Grid';
import type { CustomGrid } from '../../../src/shared/ipc-contract';

const AREA = { width: 1000, height: 800 };
const grid: CustomGrid = {
  columns: [0.5, 0.5],
  rows: [0.5, 0.5],
  cells: {
    a: { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
    b: { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
  },
};

describe('Dividers', () => {
  it('renders one handle between each pair of tracks', () => {
    render(<Dividers grid={grid} area={AREA} onPreview={() => undefined} onCommit={() => undefined} />);
    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByTestId('divider-col-0').style.left).toBe('500px');
    expect(screen.getByTestId('divider-row-0').style.top).toBe('400px');
  });

  it('previews the proportions live while dragging and commits on release', () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(<Dividers grid={grid} area={AREA} onPreview={onPreview} onCommit={onCommit} />);
    const handle = screen.getByTestId('divider-col-0');
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 10, pointerId: 1 });
    expect(onPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({ columns: [expect.closeTo(0.6, 6), expect.closeTo(0.4, 6)] }),
    );
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 600, clientY: 10, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0].columns[0]).toBeCloseTo(0.6, 6);
  });

  it('keeps a minimum track size', () => {
    const onCommit = vi.fn();
    render(<Dividers grid={grid} area={AREA} onPreview={() => undefined} onCommit={onCommit} />);
    const handle = screen.getByTestId('divider-row-0');
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 400, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 2000, pointerId: 1 });
    expect(onCommit.mock.calls[0]?.[0].rows[1]).toBeGreaterThan(0.05);
  });
});

describe('Grid reorder by dragging the header', () => {
  it('calls onReorder with the dragged and the target panel', () => {
    const onReorder = vi.fn();
    render(
      <Grid
        ids={['a', 'b']}
        renderPanel={(id) => <span>painel {id}</span>}
        observeResize={() => () => undefined}
        onReorder={onReorder}
      />,
    );
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (t: string, v: string) => data.set(t, v),
      getData: (t: string) => data.get(t) ?? '',
      types: ['application/x-melinna-panel'],
      effectAllowed: 'move',
      dropEffect: 'move',
    };
    fireEvent.dragStart(screen.getByTestId('cell-a'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('cell-b'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('cell-b'), { dataTransfer });
    expect(onReorder).toHaveBeenCalledWith('a', 'b');
  });
});
