import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TerminalSearch, isSearchShortcut } from '../../../src/renderer/components/Panel/TerminalSearch';
import type { TerminalLike } from '../../../src/renderer/terminal/xterm-types';

function fakeTerm(found = true) {
  return {
    search: vi.fn((_q: string, _d: 'next' | 'previous') => found),
    clearSearch: vi.fn(),
    focus: vi.fn(),
  } as unknown as TerminalLike & {
    search: ReturnType<typeof vi.fn>;
    clearSearch: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
  };
}

describe('TerminalSearch', () => {
  it('searches forward with Enter and backward with Shift+Enter', () => {
    const term = fakeTerm();
    render(<TerminalSearch terminal={term} onClose={() => undefined} />);
    const input = screen.getByRole('searchbox', { name: /buscar no terminal/i });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: 'erro' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(term.search.mock.calls).toEqual([
      ['erro', 'next'],
      ['erro', 'previous'],
    ]);
  });

  it('has next and previous buttons and reports no results', () => {
    const term = fakeTerm(false);
    render(<TerminalSearch terminal={term} onClose={() => undefined} />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nada' } });
    fireEvent.click(screen.getByRole('button', { name: /próximo/i }));
    fireEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(term.search.mock.calls.map((c) => c[1])).toEqual(['next', 'previous']);
    expect(screen.getByText(/sem resultados/i)).toBeTruthy();
  });

  it('ignores empty queries', () => {
    const term = fakeTerm();
    render(<TerminalSearch terminal={term} onClose={() => undefined} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
    expect(term.search).not.toHaveBeenCalled();
  });

  it('Escape clears the highlights, closes and returns the focus to the terminal', () => {
    const term = fakeTerm();
    const onClose = vi.fn();
    render(<TerminalSearch terminal={term} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    expect(term.clearSearch).toHaveBeenCalled();
    expect(term.focus).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('isSearchShortcut', () => {
  it('matches Ctrl+Shift+F only', () => {
    expect(isSearchShortcut({ key: 'F', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe(true);
    expect(isSearchShortcut({ key: 'f', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false })).toBe(true);
    expect(isSearchShortcut({ key: 'f', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false })).toBe(false);
    expect(isSearchShortcut({ key: 'F', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false })).toBe(false);
  });
});
