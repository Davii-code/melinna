import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollbackBanner } from '../../../src/renderer/components/Panel/ScrollbackBanner';

describe('ScrollbackBanner', () => {
  it('shows the disk-full message', () => {
    render(<ScrollbackBanner reason="DISK_FULL" />);
    expect(screen.getByTestId('scrollback-banner').textContent).toContain(
      'Histórico não está sendo gravado: disco cheio',
    );
  });

  it('shows a write-error message and nothing when persisting', () => {
    const { rerender } = render(<ScrollbackBanner reason="IO_ERROR" />);
    expect(screen.getByTestId('scrollback-banner').textContent).toContain('erro ao gravar');
    rerender(<ScrollbackBanner reason={null} />);
    expect(screen.queryByTestId('scrollback-banner')).toBeNull();
  });
});
