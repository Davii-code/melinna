import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseDialog } from '../../../src/renderer/components/CloseDialog';

describe('CloseDialog', () => {
  it('offers three options with "Manter rodando" as the focused default', () => {
    const onAnswer = vi.fn();
    render(<CloseDialog liveCount={3} onAnswer={onAnswer} />);
    expect(screen.getByText(/Há 3 execuções vivas/)).toBeTruthy();
    const keep = screen.getByRole('button', { name: 'Manter rodando em segundo plano' });
    expect(document.activeElement).toBe(keep);
    fireEvent.click(keep);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar todos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onAnswer.mock.calls.map((c) => c[0])).toEqual(['keep-running', 'stop-all', 'cancel', 'cancel']);
  });

  it('uses the singular for one execution', () => {
    render(<CloseDialog liveCount={1} onAnswer={() => undefined} />);
    expect(screen.getByText(/Há 1 execução viva\./)).toBeTruthy();
  });
});
