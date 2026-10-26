/*
 * Reescrito para o contrato da 009 (o seletor lista só as configurações salvas). Cenários da 007 mantidos:
 * marcar a ativa e escolher outra, mostrar as que rodam, desabilitar a que não pode rodar dizendo o motivo,
 * avisos da detecção sob o workspace, "Nenhuma configuração", editar configurações, estado de carregando.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunSelector, type RunSelectorProps } from '../../../src/renderer/components/Run/RunSelector';
import type { Group, RunConfigView } from '../../../src/shared/ipc-contract';
import { runConfig } from '../../support/renderer-fixtures';

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

const configs = (): RunConfigView[] => [
  runConfig({ id: 'a', name: 'Servidor', tool: 'program', script: null, program: 'node' }),
  runConfig({ id: 'b', name: 'dev' }),
  runConfig({ id: 'c', name: 'Maven: test', tool: 'maven', script: 'test', folder: '/repo/api' }),
  runConfig({ id: 'd', groupId: 'g2', name: 'start', folder: '/other', script: 'start' }),
];

function setup(over: Partial<RunSelectorProps> = {}) {
  const props: RunSelectorProps = {
    configs: configs(),
    warnings: [],
    groups,
    active: null,
    runningIds: new Set(),
    waiting: null,
    onChoose: vi.fn(),
    onEdit: vi.fn(),
    onAddDetected: vi.fn(),
    onCancelWaiting: vi.fn(),
    ...over,
  };
  render(<RunSelector {...props} />);
  return props;
}

const options = () => screen.getAllByRole('option').map((o) => o.textContent ?? '');

describe('RunSelector — só as salvas', () => {
  it('groups by workspace and then by tool, listing only the saved configs', () => {
    setup();
    const g1 = screen.getByTestId('run-group-g1');
    expect(within(g1).getByText('App')).toBeTruthy();
    const tools = within(g1).getAllByTestId(/^run-tool-group-/);
    expect(tools.map((t) => t.getAttribute('data-tool-group'))).toEqual(['npm', 'maven', 'program']);
    expect(
      within(tools[0] as HTMLElement)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([expect.stringContaining('dev')]);
    expect(within(tools[1] as HTMLElement).getByRole('option', { name: /Maven: test/ })).toBeTruthy();
    expect(within(screen.getByTestId('run-group-g2')).getByRole('option', { name: /start/ })).toBeTruthy();
    expect(options()).toHaveLength(4);
  });

  it('lists the configs of a tool by their order, then the folders of the tool group', () => {
    setup({
      configs: [
        runConfig({ id: 'x', name: 'zeta', order: 1 }),
        runConfig({ id: 'y', name: 'alfa', order: 0 }),
        runConfig({ id: 'z', name: 'beta', order: 0, folderGroup: 'Web' }),
      ],
    });
    expect(options().map((o) => o.replace('npm', '').trim())).toEqual(['alfa', 'zeta', 'beta']);
  });

  it('marks the tool of each configuration', () => {
    setup();
    const tools = screen.getAllByTestId('run-tool-icon').map((i) => i.getAttribute('data-tool'));
    expect(tools).toEqual(['npm', 'maven', 'program', 'npm']);
  });

  it('marks the active option and chooses another on click', () => {
    const props = setup({ active: { groupId: 'g1', commandId: 'b' } });
    expect(screen.getByRole('option', { name: /dev/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: /Servidor/ }).getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByRole('option', { name: /Servidor/ }));
    expect(props.onChoose).toHaveBeenCalledWith({ groupId: 'g1', commandId: 'a' });
  });

  it('shows which ones are running', () => {
    setup({ runningIds: new Set(['g1:b']) });
    expect(
      within(screen.getByRole('option', { name: /dev/ })).getByTestId('run-option-running'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('option', { name: /Servidor/ })).queryByTestId('run-option-running'),
    ).toBeNull();
  });

  it.each([
    ['folder-missing', 'pasta fora do workspace'],
    ['program-missing', 'não encontrado: mvn'],
    ['script-missing', 'script não existe mais'],
    ['before-launch-missing', 'etapa de "Antes de lançar" removida'],
    ['unsafe-target', 'só roda por .cmd/.bat'],
  ] as const)('disables a config that is unavailable (%s), saying why', (reason, text) => {
    const props = setup({
      configs: [
        runConfig({
          id: 'x',
          name: 'Quebrada',
          available: false,
          unavailableReason: reason,
          searched: 'mvn',
        }),
      ],
    });
    const option = screen.getByRole('option', { name: /Quebrada/ });
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain(text);
    fireEvent.click(option);
    expect(props.onChoose).not.toHaveBeenCalled();
  });

  it('shows the detection warnings under the workspace', () => {
    setup({
      warnings: [{ groupId: 'g1', folder: '/repo/api', message: 'package.json inválido; ignorado.' }],
    });
    const g1 = screen.getByTestId('run-group-g1');
    expect(within(g1).getByRole('status').textContent).toContain('package.json inválido; ignorado.');
    expect(within(g1).getByRole('status').textContent).toContain('api');
  });

  it('shows a workspace with only warnings and no configs', () => {
    setup({
      configs: [],
      warnings: [{ groupId: 'g2', folder: '/other', message: 'pom.xml maior que 1 MB; ignorado.' }],
    });
    expect(within(screen.getByTestId('run-group-g2')).getByRole('status').textContent).toContain('pom.xml');
  });
});

describe('RunSelector — vazio, carregando e ações', () => {
  it('says there is no configuration and offers both actions', () => {
    const props = setup({ configs: [] });
    expect(screen.getByText('Nenhuma configuração')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Editar configurações…' }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar a partir de um script detectado…' }));
    expect(props.onAddDetected).toHaveBeenCalledTimes(1);
  });

  it('offers both actions even with configurations listed', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Editar configurações…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar a partir de um script detectado…' }));
    expect(props.onEdit).toHaveBeenCalled();
    expect(props.onAddDetected).toHaveBeenCalled();
  });

  it('shows a loading state before the configs arrive', () => {
    setup({ configs: null });
    expect(screen.getByText('Carregando…')).toBeTruthy();
  });
});

describe('RunSelector — antes de lançar em andamento', () => {
  it('shows "Aguardando <nome>…" with a Cancelar button while a step runs', () => {
    const props = setup({ waiting: { name: 'build' } });
    const status = screen.getByTestId('run-waiting');
    expect(status.textContent).toContain('Aguardando build…');
    fireEvent.click(within(status).getByRole('button', { name: 'Cancelar' }));
    expect(props.onCancelWaiting).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when no step is running', () => {
    setup();
    expect(screen.queryByTestId('run-waiting')).toBeNull();
  });
});
