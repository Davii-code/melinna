import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunSelector, type RunSelectorProps } from '../../../src/renderer/components/Run/RunSelector';
import type { Group, RunCommand } from '../../../src/shared/ipc-contract';
import { runCommand } from '../../support/renderer-fixtures';

const groups: Group[] = [
  {
    id: 'g1',
    name: 'App',
    order: 0,
    folders: [
      { id: 'f1', path: '/repo' },
      { id: 'f2', path: '/repo/api' },
    ],
    primaryFolderId: 'f1',
  },
  { id: 'g2', name: 'Outro', order: 1, folders: [{ id: 'f3', path: '/other' }], primaryFolderId: 'f3' },
];

function setup(over: Partial<RunSelectorProps> = {}) {
  const commands: RunCommand[] = [
    runCommand({ id: 'a', label: 'Servidor', source: 'custom', tool: 'custom', program: 'node' }),
    runCommand({ id: 'b', label: 'dev' }),
    runCommand({ id: 'c', label: 'Maven: test', source: 'maven', tool: 'maven', folder: '/repo/api' }),
    runCommand({ id: 'd', groupId: 'g2', label: 'start', folder: '/other' }),
  ];
  const props: RunSelectorProps = {
    catalog: { commands, warnings: [] },
    groups,
    active: null,
    runningIds: new Set(),
    onChoose: vi.fn(),
    onEdit: vi.fn(),
    ...over,
  };
  render(<RunSelector {...props} />);
  return props;
}

const options = () => screen.getAllByRole('option').map((o) => o.textContent ?? '');

describe('RunSelector', () => {
  it('groups by workspace and folder, custom configurations before detected ones', () => {
    setup();
    const g1 = screen.getByTestId('run-group-g1');
    expect(within(g1).getByText('App')).toBeTruthy();
    const folders = within(g1).getAllByTestId(/^run-folder-/);
    expect(folders.map((f) => f.getAttribute('data-folder'))).toEqual(['/repo', '/repo/api']);
    expect(
      within(folders[0] as HTMLElement)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('Servidor'), expect.stringContaining('dev')]);
    expect(within(folders[1] as HTMLElement).getByRole('option', { name: /Maven: test/ })).toBeTruthy();
    expect(within(screen.getByTestId('run-group-g2')).getByRole('option', { name: /start/ })).toBeTruthy();
    expect(options()).toHaveLength(4);
  });

  it('marks the tool of each configuration', () => {
    setup();
    const tools = screen.getAllByTestId('run-tool-icon').map((i) => i.getAttribute('data-tool'));
    expect(tools).toEqual(['custom', 'npm', 'maven', 'npm']);
  });

  it('marks the active option and chooses another on click', () => {
    const props = setup({ active: { groupId: 'g1', commandId: 'b' } });
    expect(screen.getByRole('option', { name: /dev/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /Servidor/ }).getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByRole('option', { name: /Servidor/ }));
    expect(props.onChoose).toHaveBeenCalledWith({ groupId: 'g1', commandId: 'a' });
  });

  it('shows which ones are running', () => {
    setup({ runningIds: new Set(['b']) });
    expect(
      within(screen.getByRole('option', { name: /dev/ })).getByTestId('run-option-running'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('option', { name: /Servidor/ })).queryByTestId('run-option-running'),
    ).toBeNull();
  });

  it('disables a configuration whose tool was not found, saying what was searched', () => {
    const props = setup({
      catalog: {
        commands: [
          runCommand({
            id: 'x',
            label: 'Maven: compile',
            available: false,
            unavailableReason: 'not-found',
            searched: 'mvn',
          }),
        ],
        warnings: [],
      },
    });
    const option = screen.getByRole('option', { name: /Maven: compile/ }) as HTMLButtonElement;
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('não encontrado: mvn');
    fireEvent.click(option);
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  it('disables a configuration whose folder left the workspace', () => {
    setup({
      catalog: {
        commands: [
          runCommand({
            id: 'x',
            label: 'Servidor',
            source: 'custom',
            tool: 'custom',
            folder: '/removida',
            available: false,
            unavailableReason: 'folder-outside',
            searched: '',
          }),
        ],
        warnings: [],
      },
    });
    const option = screen.getByRole('option', { name: /Servidor/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('pasta fora do workspace');
  });

  it('shows the detection warnings under the workspace', () => {
    setup({
      catalog: {
        commands: [runCommand()],
        warnings: [{ groupId: 'g1', folder: '/repo/api', message: 'package.json inválido; ignorado.' }],
      },
    });
    const g1 = screen.getByTestId('run-group-g1');
    expect(within(g1).getByRole('status').textContent).toContain('package.json inválido; ignorado.');
    expect(within(g1).getByRole('status').textContent).toContain('api');
  });

  it('says there is no configuration and offers to edit', () => {
    const props = setup({ catalog: { commands: [], warnings: [] } });
    expect(screen.getByText('Nenhuma configuração')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Editar configurações' }));
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('offers to edit even with configurations listed', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Editar configurações' }));
    expect(props.onEdit).toHaveBeenCalled();
  });

  it('shows a loading state before the catalog arrives', () => {
    setup({ catalog: null });
    expect(screen.getByText('Carregando…')).toBeTruthy();
  });
});
