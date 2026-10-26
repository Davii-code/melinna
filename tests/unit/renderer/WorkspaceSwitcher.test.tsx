import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '../../../src/renderer/components/WorkspaceSwitcher';
import { useGitWorkspace } from '../../../src/renderer/git/git-workspace';
import { bandColor } from '../../../src/renderer/theme/bands';
import type { Group } from '../../../src/shared/ipc-contract';
import { renderWithGit } from '../../support/git-render';

const groups: Group[] = [
  { id: 'g1', name: 'meu-site', order: 0, repoPath: '/a', colorIndex: 1 },
  { id: 'g2', name: 'api', order: 1, repoPath: '/b', colorIndex: 4 },
];

let release: () => void = () => undefined;
function Busy() {
  const gw = useGitWorkspace();
  return (
    <button
      type="button"
      onClick={() => void gw.runExclusive(() => new Promise<void>((r) => (release = r)))}
    >
      ocupar
    </button>
  );
}

function setup(activeId: string | null = 'g1', list: Group[] = groups) {
  const onSelect = vi.fn();
  renderWithGit(
    <>
      <WorkspaceSwitcher groups={list} activeId={activeId} onSelect={onSelect} />
      <Busy />
    </>,
    { roots: ['/a'] },
  );
  return { onSelect };
}

beforeEach(() => localStorage.clear());

describe('WorkspaceSwitcher', () => {
  it('shows the active workspace with an initials icon in the band color', () => {
    setup('g2');
    const trigger = screen.getByRole('button', { name: /Workspace ativo/ });
    expect(trigger.textContent).toContain('api');
    const icon = trigger.querySelector('.ws-icon') as HTMLElement;
    expect(icon.textContent).toBe('AP');
    expect(icon.style.background).not.toBe('');
    expect(icon.getAttribute('data-band')).toBe(bandColor(4));
  });

  it('lists the workspaces and selecting one stores it and reports it', () => {
    const { onSelect } = setup('g1');
    fireEvent.click(screen.getByRole('button', { name: /Workspace ativo/ }));
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual(['MSmeu-site', 'APapi']);
    expect(items[0]?.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(items[1] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('g2');
    expect(localStorage.getItem('melinna.activeWorkspace')).toBe('g2');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('falls back to the first workspace when the stored one is gone', () => {
    setup('sumiu');
    expect(screen.getByRole('button', { name: /Workspace ativo/ }).textContent).toContain('meu-site');
  });

  it('is disabled with a hint during a commit or push sequence', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'ocupar' }));
    const trigger = screen.getByRole('button', { name: /Workspace ativo/ }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(trigger.title).toMatch(/commit ou do push/);
    await act(async () => release());
    expect((screen.getByRole('button', { name: /Workspace ativo/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('closes with Escape', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Workspace ativo/ }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not appear without workspaces', () => {
    setup(null, []);
    expect(screen.queryByRole('button', { name: /Workspace ativo/ })).toBeNull();
  });
});
