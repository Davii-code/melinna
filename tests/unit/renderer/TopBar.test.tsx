import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../../src/renderer/components/TopBar';

describe('TopBar', () => {
  it('shows the wordmark, the free slots and the new task button', () => {
    const onNewTask = vi.fn();
    render(<TopBar onNewTask={onNewTask} freeSlots={4} />);
    expect(screen.getByAltText('melinna')).toBeTruthy();
    expect(screen.getByTestId('free-slots').textContent).toBe('4 vagas');
    fireEvent.click(screen.getByRole('button', { name: 'Nova tarefa' }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it('disables new tasks without free slots', () => {
    render(<TopBar onNewTask={() => undefined} freeSlots={0} />);
    expect((screen.getByRole('button', { name: 'Nova tarefa' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
