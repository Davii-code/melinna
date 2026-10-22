import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tree, type TreeProps } from '../../../src/renderer/components/Tree/Tree';
import type { Group, Task } from '../../../src/shared/ipc-contract';
import { agentDef, execution } from '../../support/renderer-fixtures';

const groups: Group[] = [
  { id: 'g2', name: 'Segundo', order: 1 },
  { id: 'g1', name: 'Primeiro', order: 0 },
];

function task(id: string, groupId: string, title: string): Task {
  return {
    id,
    groupId,
    title,
    prompt: 'p',
    repoPath: '/repo',
    repoId: 'r',
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    slug: 's',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function setup(over: Partial<TreeProps> = {}) {
  const props: TreeProps = {
    groups,
    tasks: [task('t1', 'g1', 'Busca'), task('t2', 'g2', 'Login')],
    executions: [
      execution('e1', { taskId: 't1', bandIndex: 0, status: 'running' }),
      execution('e2', { taskId: 't1', bandIndex: 1, status: 'exited', exitCode: 3, agentId: 'codex' }),
      execution('e3', { taskId: 't2', bandIndex: 0, status: 'failed_to_start' }),
      execution('e4', { taskId: 't1', bandIndex: 6, status: 'preparing' }),
    ],
    agents: new Map([
      ['claude', agentDef('claude')],
      ['codex', agentDef('codex', { displayName: 'Codex CLI' })],
    ]),
    openIds: ['e1'],
    onOpen: vi.fn(),
    onStop: vi.fn(),
    onRelaunch: vi.fn(),
    onRemove: vi.fn(),
    onRenameGroup: vi.fn(),
    onRenameTask: vi.fn(),
    onRemoveTask: vi.fn(),
    onRemoveGroup: vi.fn(),
    ...over,
  };
  render(<Tree {...props} />);
  return props;
}

const row = (id: string) => screen.getByTestId(`tree-exec-${id}`);

describe('Tree', () => {
  it('shows groups by order, then tasks, then executions with band and status', () => {
    setup();
    const names = screen.getAllByTestId(/^tree-group-name-/).map((n) => n.textContent);
    expect(names).toEqual(['Primeiro', 'Segundo']);
    const g1 = screen.getByTestId('tree-group-g1');
    expect(within(g1).getByText('Busca')).toBeTruthy();
    expect(within(g1).queryByText('Login')).toBeNull();
    expect(within(row('e1')).getByText('Claude Code')).toBeTruthy();
    expect(within(row('e1')).getByText('rodando')).toBeTruthy();
    expect(within(row('e2')).getByText('Codex CLI')).toBeTruthy();
    expect(within(row('e2')).getByText('encerrado (código 3)')).toBeTruthy();
    expect(within(row('e3')).getByText('falhou ao iniciar')).toBeTruthy();
    expect(within(row('e4')).getByText('preparando')).toBeTruthy();
    expect((row('e2').querySelector('.band') as HTMLElement).style.background).toBe('rgb(255, 159, 10)');
    expect(within(row('e4')).getByTestId('band-number').textContent).toBe('7');
  });

  it('enables actions according to the state', () => {
    setup();
    const btn = (id: string, name: RegExp) =>
      within(row(id)).getByRole('button', { name }) as HTMLButtonElement;
    expect(btn('e1', /parar/i).disabled).toBe(false);
    expect(btn('e1', /relançar/i).disabled).toBe(true);
    expect(btn('e1', /remover/i).disabled).toBe(true);
    expect(btn('e2', /parar/i).disabled).toBe(true);
    expect(btn('e2', /relançar/i).disabled).toBe(false);
    expect(btn('e2', /remover/i).disabled).toBe(false);
    expect(btn('e3', /relançar/i).disabled).toBe(false);
    expect(btn('e4', /parar/i).disabled).toBe(true);
    expect(btn('e4', /remover/i).disabled).toBe(true);
  });

  it('calls the action callbacks with the execution id', () => {
    const p = setup();
    fireEvent.click(within(row('e1')).getByRole('button', { name: /parar/i }));
    fireEvent.click(within(row('e2')).getByRole('button', { name: /relançar/i }));
    fireEvent.click(within(row('e2')).getByRole('button', { name: /remover/i }));
    expect(p.onStop).toHaveBeenCalledWith('e1');
    expect(p.onRelaunch).toHaveBeenCalledWith('e2');
    expect(p.onRemove).toHaveBeenCalledWith('e2');
  });

  it('opening an already open execution focuses it instead of duplicating', () => {
    const p = setup();
    const openBtn = within(row('e1')).getByRole('button', { name: /focar/i });
    expect(row('e1').getAttribute('aria-current')).toBe('true');
    fireEvent.click(openBtn);
    fireEvent.click(within(row('e2')).getByRole('button', { name: /abrir/i }));
    expect(p.onOpen).toHaveBeenNthCalledWith(1, 'e1');
    expect(p.onOpen).toHaveBeenNthCalledWith(2, 'e2');
    expect(row('e2').getAttribute('aria-current')).toBeNull();
  });

  it('renames a group inline with Enter and cancels with Escape', () => {
    const p = setup();
    fireEvent.doubleClick(screen.getByTestId('tree-group-name-g1'));
    const input = screen.getByRole('textbox', { name: /nome do grupo/i });
    fireEvent.change(input, { target: { value: 'Frente nova' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRenameGroup).toHaveBeenCalledWith('g1', 'Frente nova');
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.doubleClick(screen.getByTestId('tree-group-name-g2'));
    const again = screen.getByRole('textbox', { name: /nome do grupo/i });
    fireEvent.change(again, { target: { value: 'Descartado' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    expect(p.onRenameGroup).toHaveBeenCalledTimes(1);
  });

  it('renames a task inline and ignores blank values', () => {
    const p = setup();
    fireEvent.doubleClick(screen.getByTestId('tree-task-name-t1'));
    const input = screen.getByRole('textbox', { name: /título da tarefa/i });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(p.onRenameTask).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByTestId('tree-task-name-t1'));
    const input2 = screen.getByRole('textbox', { name: /título da tarefa/i });
    fireEvent.change(input2, { target: { value: 'Busca rápida' } });
    fireEvent.blur(input2);
    expect(p.onRenameTask).toHaveBeenCalledWith('t1', 'Busca rápida');
  });

  it('shows an empty state without groups', () => {
    setup({ groups: [], tasks: [], executions: [] });
    expect(screen.getByText(/nenhuma tarefa/i)).toBeTruthy();
  });

  it('removes a stopped session or workspace and blocks removal while something runs', () => {
    const props = setup();
    const removeBusca = screen.getByRole('button', { name: 'Remover sessão Busca' }) as HTMLButtonElement;
    const removeLogin = screen.getByRole('button', { name: 'Remover sessão Login' }) as HTMLButtonElement;
    expect(removeBusca.disabled).toBe(true);
    expect(removeLogin.disabled).toBe(false);
    fireEvent.click(removeLogin);
    expect(props.onRemoveTask).toHaveBeenCalledWith('t2');
    expect(
      (screen.getByRole('button', { name: 'Remover workspace Primeiro' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover workspace Segundo' }));
    expect(props.onRemoveGroup).toHaveBeenCalledWith('g2');
  });

  it('shows the tools only under executions with an open panel', () => {
    setup({ execTools: (e) => <button type="button">ferramentas de {e.id}</button> });
    expect(within(row('e1')).getByRole('button', { name: 'ferramentas de e1' })).toBeTruthy();
    expect(within(row('e2')).queryByRole('button', { name: /ferramentas/ })).toBeNull();
  });

  it('shows "parando…" and blocks a second stop while the stop is in progress', () => {
    setup({ stoppingIds: ['e1'] });
    expect(screen.getByTestId('tree-exec-status-e1').textContent).toBe('parando…');
    expect((within(row('e1')).getByRole('button', { name: /parar/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('"+" on a session lists the installed AIs and adds a terminal with the chosen one', () => {
    const onAddTerminal = vi.fn();
    setup({
      launchable: [agentDef('claude'), agentDef('codex', { displayName: 'Codex CLI' })],
      onAddTerminal,
    });
    const plus = screen.getByRole('button', { name: 'Novo terminal na sessão Login' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(plus);
    const menu = screen.getByRole('menu', { name: 'Novo terminal na sessão Login' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['Claude Code', 'Codex CLI']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Codex CLI' }));
    expect(onAddTerminal).toHaveBeenCalledWith('t2', 'codex');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('"+" on a workspace opens a new session, and the menu closes with Esc', () => {
    const onNewSession = vi.fn();
    setup({
      groups: [{ id: 'w1', name: 'site', order: 0, repoPath: '/repos/site' }],
      tasks: [],
      executions: [],
      launchable: [agentDef('claude')],
      onNewSession,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Nova sessão em site' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nova sessão em site' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Claude Code' }));
    expect(onNewSession).toHaveBeenCalledWith('w1', 'claude');
  });

  it('disables "+" when no AI is installed and hides it without a handler', () => {
    setup({ launchable: [], onAddTerminal: vi.fn() });
    expect(
      (screen.getByRole('button', { name: 'Novo terminal na sessão Login' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: /nova sessão em/i })).toBeNull();
  });

  it('opens the panel when the execution row itself is clicked, but not when a button in it is', () => {
    const props = setup();
    fireEvent.click(within(row('e2')).getByText('Codex CLI'));
    expect(props.onOpen).toHaveBeenCalledWith('e2');
    (props.onOpen as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(within(row('e2')).getByRole('button', { name: /relançar/i }));
    expect(props.onRelaunch).toHaveBeenCalledWith('e2');
    expect(props.onOpen).not.toHaveBeenCalled();
  });
});
