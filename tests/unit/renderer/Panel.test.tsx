import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PanelHeader } from '../../../src/renderer/components/Panel/PanelHeader';
import { agentDef, execution } from '../../support/renderer-fixtures';

describe('PanelHeader', () => {
  it('shows band color, agent, model, mode and status', () => {
    render(
      <PanelHeader
        execution={execution('e1', { bandIndex: 1, status: 'idle' })}
        agent={agentDef('claude')}
        onClose={() => undefined}
      />,
    );
    expect((screen.getByTestId('panel-header').querySelector('.band') as HTMLElement).style.background).toBe(
      'rgb(255, 159, 10)',
    );
    expect(screen.getByText('Claude Code')).toBeTruthy();
    expect(screen.getByTestId('panel-model').textContent).toBe('Sonnet');
    expect(screen.getByTestId('panel-mode').textContent).toBe('Perguntar');
    expect(screen.getByTestId('panel-status').textContent).toBe('ocioso');
    expect(screen.queryByTestId('band-number')).toBeNull();
  });

  it('numbers executions from the 7th on, repeating the colors', () => {
    render(
      <PanelHeader
        execution={execution('e7', { bandIndex: 6 })}
        agent={agentDef('claude')}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId('band-number').textContent).toBe('7');
    expect((screen.getByTestId('panel-header').querySelector('.band') as HTMLElement).style.background).toBe(
      'rgb(255, 59, 48)',
    );
  });

  it('labels every status in pt-BR', () => {
    const cases: [Parameters<typeof execution>[1], string][] = [
      [{ status: 'preparing' }, 'preparando'],
      [{ status: 'starting' }, 'iniciando'],
      [{ status: 'running' }, 'rodando'],
      [{ status: 'exited', exitCode: 2 }, 'encerrado (código 2)'],
      [{ status: 'exited', exitCode: null, signal: 'SIGKILL' }, 'encerrado (sinal SIGKILL)'],
      [{ status: 'failed_to_start' }, 'falhou ao iniciar'],
      [{ status: 'lost' }, 'perdido'],
    ];
    for (const [over, label] of cases) {
      const { unmount } = render(
        <PanelHeader execution={execution('x', over)} agent={agentDef('claude')} onClose={() => undefined} />,
      );
      expect(screen.getByTestId('panel-status').textContent).toBe(label);
      unmount();
    }
  });

  it('close button only closes the panel', () => {
    const onClose = vi.fn();
    render(<PanelHeader execution={execution('e1')} agent={agentDef('claude')} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
