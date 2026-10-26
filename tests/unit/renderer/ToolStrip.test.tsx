import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolStrip, type ToolStripProps } from '../../../src/renderer/components/Layout/ToolStrip';

function setup(over: Partial<ToolStripProps> = {}) {
  const props: ToolStripProps = {
    panel: 'workspaces',
    collapsed: false,
    changes: 0,
    onSelect: vi.fn(),
    onPrompts: vi.fn(),
    onCatalog: vi.fn(),
    ...over,
  };
  render(<ToolStrip {...props} />);
  return props;
}

describe('ToolStrip', () => {
  it('has Workspaces, Arquivos and Commit with name and shortcut in the tooltip', () => {
    setup();
    for (const [name, key] of [
      ['Workspaces', 'Alt+1'],
      ['Arquivos', 'Alt+2'],
      ['Commit', 'Alt+0'],
    ] as const) {
      const button = screen.getByRole('button', { name: `${name} (${key})` });
      expect(button.getAttribute('title')).toBe(`${name} (${key})`);
    }
  });

  it('selecting a panel calls onSelect with it', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Commit (Alt+0)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arquivos (Alt+2)' }));
    expect(props.onSelect).toHaveBeenNthCalledWith(1, 'commit');
    expect(props.onSelect).toHaveBeenNthCalledWith(2, 'files');
  });

  it('highlights the active panel with aria-pressed', () => {
    setup({ panel: 'commit' });
    expect(screen.getByRole('button', { name: 'Commit (Alt+0)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Workspaces (Alt+1)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows no panel as active while the sidebar is collapsed, and clicking the panel still reports it', () => {
    const props = setup({ panel: 'commit', collapsed: true });
    const commit = screen.getByRole('button', { name: 'Commit (Alt+0)' });
    expect(commit.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(commit);
    expect(props.onSelect).toHaveBeenCalledWith('commit');
  });

  it('shows a badge with the number of changes on Commit, only when there are some', () => {
    const { unmount } = render(
      <ToolStrip panel="files" collapsed={false} changes={7} onSelect={vi.fn()} onPrompts={vi.fn()} onCatalog={vi.fn()} />,
    );
    const commit = screen.getByRole('button', { name: 'Commit (Alt+0)' });
    expect(within(commit).getByTestId('commit-badge').textContent).toBe('7');
    unmount();
    setup({ changes: 0 });
    expect(screen.queryByTestId('commit-badge')).toBeNull();
  });

  it('caps the badge at 99+', () => {
    setup({ changes: 250 });
    expect(screen.getByTestId('commit-badge').textContent).toBe('99+');
  });

  it('has prompt library and catalog at the bottom calling their actions', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Biblioteca de prompts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Catálogo de agentes' }));
    expect(props.onPrompts).toHaveBeenCalledTimes(1);
    expect(props.onCatalog).toHaveBeenCalledTimes(1);
  });
});
