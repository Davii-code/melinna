import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunConfigTree } from '../../../src/renderer/components/Run/RunConfigTree';
import { draftFromView, type DraftItem } from '../../../src/renderer/components/Run/run-draft';
import { runCommand, runConfig } from '../../support/renderer-fixtures';

const items = (...over: Parameters<typeof runConfig>[0][]): DraftItem[] =>
  over.map((o) => draftFromView(runConfig(o)));

function setup(opts: Partial<React.ComponentProps<typeof RunConfigTree>> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onAddDetected: vi.fn(),
    onCopy: vi.fn(),
    onRemove: vi.fn(),
    onNewFolder: vi.fn(),
    onSort: vi.fn(),
    onMove: vi.fn(),
  };
  const props = {
    items: items(
      { id: 'a', name: 'dev', tool: 'npm' },
      { id: 'b', name: 'build', tool: 'npm', folderGroup: 'Web' },
      { id: 'c', name: 'Verify', tool: 'maven', script: 'verify' },
      { id: 'd', name: 'Servidor', tool: 'program', script: null, program: 'node' },
    ),
    selectedKey: 'a',
    extraFolders: [] as string[],
    detected: [runCommand({ id: 'x1', label: 'lint', args: ['run', 'lint'], folder: '/repo/api' })],
    ...handlers,
    ...opts,
  };
  render(<RunConfigTree {...props} />);
  return handlers;
}

const tree = () => screen.getByRole('tree');
const item = (name: string) => within(tree()).getByRole('treeitem', { name });

describe('RunConfigTree — árvore', () => {
  it('groups by tool (npm, Maven, Gradle, Compose, Programa) and by folder, only for tools that have configs', () => {
    setup();
    const labels = within(tree())
      .getAllByRole('treeitem')
      .filter((n) => n.hasAttribute('aria-expanded'))
      .map((n) => n.getAttribute('aria-label'));
    expect(labels).toEqual(['npm', 'Web', 'Maven', 'Programa']);
  });

  it('selects the active one and reports a click', () => {
    const h = setup();
    expect(item('dev').getAttribute('aria-selected')).toBe('true');
    expect(item('build').getAttribute('aria-selected')).toBe('false');
    fireEvent.click(item('build'));
    expect(h.onSelect).toHaveBeenCalledWith('b');
  });

  it('puts the configs of a folder inside its folder node', () => {
    setup();
    const web = item('Web');
    expect(within(web).getByRole('treeitem', { name: 'build' })).toBeTruthy();
    expect(within(web).queryByRole('treeitem', { name: 'dev' })).toBeNull();
  });

  it('shows an empty folder created with Nova pasta under the tool groups', () => {
    setup({ extraFolders: ['Vazia'] });
    expect(within(tree()).getAllByRole('treeitem', { name: 'Vazia' }).length).toBeGreaterThan(0);
  });

  it('collapses and expands a group with the arrow keys', () => {
    setup();
    const group = item('Maven');
    group.focus();
    expect(within(group).getByRole('treeitem', { name: 'Verify' })).toBeTruthy();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(within(item('Maven')).queryByRole('treeitem', { name: 'Verify' })).toBeNull();
    fireEvent.keyDown(item('Maven'), { key: 'ArrowRight' });
    expect(within(item('Maven')).getByRole('treeitem', { name: 'Verify' })).toBeTruthy();
  });

  it('moves the focus with ArrowDown and ArrowUp and selects with Enter', () => {
    const h = setup();
    item('dev').focus();
    fireEvent.keyDown(item('dev'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(item('Web'));
    fireEvent.keyDown(item('Web'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(item('dev'));
    fireEvent.keyDown(item('dev'), { key: 'Enter' });
    expect(h.onSelect).toHaveBeenCalledWith('a');
  });

  it('marks a running config', () => {
    setup({ items: items({ id: 'a', name: 'dev', running: 2 }) });
    expect(within(item('dev')).getByTestId('run-config-running')).toBeTruthy();
  });
});

describe('RunConfigTree — barra', () => {
  it('lists the tools and the detected scripts under Adicionar configuração', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar configuração' }));
    const menu = screen.getByRole('menu', { name: 'Tipos de configuração' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['npm', 'Maven', 'Gradle', 'Compose', 'Programa', 'lint (api)']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Maven' }));
    expect(h.onAdd).toHaveBeenCalledWith('maven');
    expect(screen.queryByRole('menu', { name: 'Tipos de configuração' })).toBeNull();
  });

  it('adds from a detected script', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar configuração' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'lint (api)' }));
    expect(h.onAddDetected).toHaveBeenCalledWith(expect.objectContaining({ id: 'x1' }));
  });

  it('copies the selected config', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Copiar configuração' }));
    expect(h.onCopy).toHaveBeenCalledTimes(1);
  });

  it('disables copy and remove without a selection', () => {
    setup({ selectedKey: null });
    expect((screen.getByRole('button', { name: 'Copiar configuração' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Remover configuração' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('asks for confirmation naming the config before removing', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remover configuração' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('"dev"');
    expect(h.onRemove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(h.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remover configuração' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
    expect(h.onRemove).toHaveBeenCalledWith('a');
  });

  it('disables remove while the selected config is running', () => {
    setup({ items: items({ id: 'a', name: 'dev', running: 1 }) });
    const remove = screen.getByRole('button', { name: 'Remover configuração' }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.title).toContain('rodando');
  });

  it('creates a folder with Nova pasta', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Nova pasta' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da pasta' }), {
      target: { value: '  Backend ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar pasta' }));
    expect(h.onNewFolder).toHaveBeenCalledWith('Backend');
  });

  it('does not create a folder with a blank name', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Nova pasta' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da pasta' }), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Criar pasta' }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.onNewFolder).not.toHaveBeenCalled();
  });

  it('sorts alphabetically', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar' }));
    expect(h.onSort).toHaveBeenCalledTimes(1);
  });
});

describe('RunConfigTree — mover para pasta', () => {
  it('moves by dragging a config onto a folder', () => {
    const h = setup();
    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => (data[k] = v),
      getData: (k: string) => data[k] ?? '',
      effectAllowed: '',
    };
    fireEvent.dragStart(item('dev'), { dataTransfer });
    fireEvent.dragOver(item('Web'), { dataTransfer });
    fireEvent.drop(item('Web'), { dataTransfer });
    expect(h.onMove).toHaveBeenCalledWith('a', 'Web');
  });

  it('moves with the keyboard through the row menu', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de dev' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mover para pasta…' }));
    const list = screen.getByRole('menu', { name: 'Pastas' });
    expect(
      within(list)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Sem pasta', 'Web']);
    fireEvent.click(within(list).getByRole('menuitem', { name: 'Web' }));
    expect(h.onMove).toHaveBeenCalledWith('a', 'Web');
  });

  it('moves out of a folder with Sem pasta', () => {
    const h = setup({ selectedKey: 'b' });
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de build' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mover para pasta…' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sem pasta' }));
    expect(h.onMove).toHaveBeenCalledWith('b', null);
  });
});
