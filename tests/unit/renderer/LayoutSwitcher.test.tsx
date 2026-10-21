import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LayoutSwitcher } from '../../../src/renderer/components/LayoutSwitcher';

describe('LayoutSwitcher', () => {
  it('shows the four modes with the current one pressed', () => {
    render(<LayoutSwitcher mode="sidebar" onChange={() => undefined} onCycleFocus={() => undefined} />);
    const names = screen.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')]);
    expect(names).toEqual([
      ['Automático', 'false'],
      ['Spotlight', 'false'],
      ['Sidebar', 'true'],
      ['Grade personalizada', 'false'],
    ]);
  });

  it('changes the mode', () => {
    const onChange = vi.fn();
    render(<LayoutSwitcher mode="auto" onChange={onChange} onCycleFocus={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Grade personalizada' }));
    expect(onChange).toHaveBeenCalledWith('custom');
  });

  it('Ctrl+Alt+arrows cycle the focus in spotlight only', () => {
    const onCycle = vi.fn();
    const { rerender } = render(<LayoutSwitcher mode="spotlight" onChange={() => undefined} onCycleFocus={onCycle} />);
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowLeft', ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });
    expect(onCycle.mock.calls).toEqual([[1], [-1]]);
    rerender(<LayoutSwitcher mode="auto" onChange={() => undefined} onCycleFocus={onCycle} />);
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true, altKey: true });
    expect(onCycle).toHaveBeenCalledTimes(2);
  });
});
