import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DetectedPicker } from '../../../src/renderer/components/Run/DetectedPicker';
import type { Group, RunCommand } from '../../../src/shared/ipc-contract';
import { runCommand } from '../../support/renderer-fixtures';

const group: Group = {
  id: 'g1',
  name: 'App',
  order: 0,
  folders: [
    { id: 'f1', path: '/repo' },
    { id: 'f2', path: '/repo/api' },
  ],
  primaryFolderId: 'f1',
};

const detected: RunCommand[] = [
  runCommand({ id: 'a', label: 'dev', args: ['run', 'dev'], folder: '/repo' }),
  runCommand({ id: 'b', label: 'build', args: ['run', 'build'], folder: '/repo' }),
  runCommand({
    id: 'c',
    label: 'Maven: test',
    source: 'maven',
    tool: 'maven',
    program: 'mvn',
    args: ['test'],
    folder: '/repo/api',
  }),
  runCommand({ id: 'd', groupId: 'g2', label: 'start', folder: '/other' }),
];

function setup(groupId: string | null = 'g1') {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <DetectedPicker
      detected={detected}
      groups={[group]}
      groupId={groupId}
      onPick={onPick}
      onClose={onClose}
    />,
  );
  return { onPick, onClose };
}

describe('DetectedPicker', () => {
  it('lists the scripts detected in the active workspace by folder and tool', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Scripts detectados' });
    const folders = within(dialog).getAllByTestId(/^detected-folder-/);
    expect(folders.map((f) => f.getAttribute('data-folder'))).toEqual(['/repo', '/repo/api']);
    expect(
      within(folders[0] as HTMLElement)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([expect.stringContaining('dev'), expect.stringContaining('build')]);
    expect(within(folders[1] as HTMLElement).getByRole('button', { name: /Maven: test/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /start/ })).toBeNull();
  });

  it('marks the tool of each script', () => {
    setup();
    const tools = screen.getAllByTestId('run-tool-icon').map((i) => i.getAttribute('data-tool'));
    expect(tools).toEqual(['npm', 'npm', 'maven']);
  });

  it('picks a script and reports it', () => {
    const { onPick } = setup();
    fireEvent.click(screen.getByRole('button', { name: /build/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('says there is nothing detected when the workspace has none', () => {
    setup('g9');
    expect(screen.getByText('Nenhum script detectado neste workspace.')).toBeTruthy();
  });

  it('closes with Esc and with the close button', () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
