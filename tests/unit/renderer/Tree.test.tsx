import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Tree, type TreeProps } from '../../../src/renderer/components/Tree/Tree';
import type { Execution, Group, QueueItem, Task } from '../../../src/shared/ipc-contract';
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

const multi: Group = {
  id: 'w9',
  name: 'Plataforma',
  order: 0,
  folders: [
    { id: 'f1', path: '/repos/site' },
    { id: 'f2', path: '/repos/api' },
  ],
  primaryFolderId: 'f2',
  repoPath: '/repos/api',
  colorIndex: 1,
};

describe('Tree — workspace com várias pastas', () => {
  it('lists every folder in the tooltip and marks the primary one', () => {
    setup({ groups: [multi], tasks: [], executions: [], onEditGroup: vi.fn() });
    const title = screen.getByTestId('tree-group-w9').querySelector('.tree-group-row')?.getAttribute('title');
    expect(title).toBe('/repos/site\n/repos/api (principal)');
  });

  it('keeps the plain path as the tooltip of a one-folder workspace', () => {
    const single: Group = {
      ...multi,
      folders: [{ id: 'f1', path: '/repos/site' }],
      primaryFolderId: 'f1',
      repoPath: '/repos/site',
    };
    setup({ groups: [single], tasks: [], executions: [], onEditGroup: vi.fn() });
    expect(screen.getByTestId('tree-group-w9').querySelector('.tree-group-row')?.getAttribute('title')).toBe(
      '/repos/site',
    );
  });

  it('shows "Editar workspace" and calls onEditGroup with the workspace id', () => {
    const onEditGroup = vi.fn();
    setup({ groups: [multi], tasks: [], executions: [], onEditGroup });
    fireEvent.click(screen.getByRole('button', { name: 'Editar workspace Plataforma' }));
    expect(onEditGroup).toHaveBeenCalledWith('w9');
  });

  it('hides the edit button without a handler and for a group without a folder', () => {
    setup({ groups: [multi], tasks: [], executions: [] });
    expect(screen.queryByRole('button', { name: /editar workspace/i })).toBeNull();
  });

  it('keeps the edit button available while sessions are live', () => {
    const t = { ...task('t9', 'w9', 'Sessão'), repoPath: '/repos/api' };
    setup({
      groups: [multi],
      tasks: [t],
      executions: [execution('e9', { taskId: 't9', status: 'running' })],
      onEditGroup: vi.fn(),
    });
    expect(
      (screen.getByRole('button', { name: 'Editar workspace Plataforma' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('Tree — aviso de pastas extras', () => {
  const withNotices = (notices?: Execution['notices']) =>
    setup({
      groups: [multi],
      tasks: [{ ...task('t9', 'w9', 'Sessão'), repoPath: '/repos/api' }],
      executions: [execution('e9', { taskId: 't9', ...(notices ? { notices } : {}) })],
    });

  it('shows "só a principal" when the agent does not take extra folders', () => {
    withNotices([{ kind: 'extra-dirs-unsupported' }]);
    expect(within(row('e9')).getByText('só a principal')).toBeTruthy();
  });

  it('shows how many folders were left out', () => {
    withNotices([{ kind: 'extra-dirs-omitted', count: 2 }]);
    expect(within(row('e9')).getByText('2 pastas indisponíveis')).toBeTruthy();
  });

  it('uses the singular for one folder', () => {
    withNotices([{ kind: 'extra-dirs-omitted', count: 1 }]);
    expect(within(row('e9')).getByText('1 pasta indisponível')).toBeTruthy();
  });

  it('shows no badge without notices, or with an empty list', () => {
    withNotices();
    expect(within(row('e9')).queryByTestId('tree-exec-notice-e9')).toBeNull();
    cleanup();
    withNotices([]);
    expect(within(row('e9')).queryByTestId('tree-exec-notice-e9')).toBeNull();
  });
});

describe('Tree — clipe de imagem', () => {
  const withImages = agentDef('claude', { images: { template: '{path}', quote: 'when-needed' } });
  const clip = (name: string) => screen.queryByRole('button', { name: `Anexar imagem a ${name}` });

  function imagesSetup(status: Execution['status'], over: Partial<TreeProps> = {}, withHandler = true) {
    return setup({
      groups: [multi],
      tasks: [{ ...task('t9', 'w9', 'Sessão'), repoPath: '/repos/api' }],
      executions: [execution('e9', { taskId: 't9', status })],
      agents: new Map([['claude', withImages]]),
      ...(withHandler ? { onAttachImage: vi.fn() } : {}),
      ...over,
    });
  }

  it('shows the clip on a live execution of an agent that takes images and calls onAttachImage', () => {
    const props = imagesSetup('running');
    fireEvent.click(clip('Claude Code') as HTMLElement);
    expect(props.onAttachImage).toHaveBeenCalledWith('e9');
  });

  it('shows the clip for an idle execution too', () => {
    imagesSetup('idle');
    expect(clip('Claude Code')).toBeTruthy();
  });

  it.each(['exited', 'preparing', 'starting', 'failed_to_start', 'lost'] as const)(
    'hides the clip when the execution is %s',
    (status) => {
      imagesSetup(status);
      expect(clip('Claude Code')).toBeNull();
    },
  );

  it('hides the clip for an agent that does not take images', () => {
    imagesSetup('running', { agents: new Map([['claude', agentDef('claude')]]) });
    expect(clip('Claude Code')).toBeNull();
  });

  it('hides the clip without a handler', () => {
    imagesSetup('running', {}, false);
    expect(clip('Claude Code')).toBeNull();
  });

  it('clicking the clip does not open the panel of the row', () => {
    const props = imagesSetup('running');
    fireEvent.click(clip('Claude Code') as HTMLElement);
    expect(props.onOpen).not.toHaveBeenCalled();
  });
});

describe('Tree: fila de prompts', () => {
  const item = (id: string, text: string): QueueItem => ({
    id,
    text,
    enqueuedAt: '2026-10-22T10:00:00.000Z',
  });
  const queues = new Map<string, readonly QueueItem[]>([
    ['e1', [item('q1', 'rode os testes'), item('q2', 'depois faça o commit')]],
    ['e2', [item('q3', 'só um')]],
  ]);

  function queueSetup(over: Partial<TreeProps> = {}) {
    return setup({
      queues,
      onRemoveQueueItem: vi.fn(),
      onClearQueue: vi.fn(),
      onDismissDiscarded: vi.fn(),
      ...over,
    });
  }

  it('shows no badge for a session without queue', () => {
    setup();
    expect(within(row('e1')).queryByText(/na fila/)).toBeNull();
    expect(within(row('e3')).queryByRole('button', { name: /fila/i })).toBeNull();
  });

  it('shows how many prompts are queued', () => {
    queueSetup();
    expect(within(row('e1')).getByText('2 na fila')).toBeTruthy();
    expect(within(row('e2')).getByText('1 na fila')).toBeTruthy();
    expect(within(row('e3')).queryByText(/na fila/)).toBeNull();
  });

  it('opens the queue menu with the queued texts and closes it again', () => {
    queueSetup();
    expect(within(row('e1')).queryByRole('list', { name: 'Fila de Claude Code' })).toBeNull();
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Ver fila de Claude Code' }));
    const list = within(row('e1')).getByRole('list', { name: 'Fila de Claude Code' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('rode os testes'), expect.stringContaining('depois faça o commit')]);
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Ver fila de Claude Code' }));
    expect(within(row('e1')).queryByRole('list', { name: 'Fila de Claude Code' })).toBeNull();
  });

  it('removes one queued item', () => {
    const props = queueSetup();
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Ver fila de Claude Code' }));
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Remover da fila: depois faça o commit' }));
    expect(props.onRemoveQueueItem).toHaveBeenCalledWith('e1', 'q2');
  });

  it('clears the queue', () => {
    const props = queueSetup();
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Ver fila de Claude Code' }));
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Limpar fila' }));
    expect(props.onClearQueue).toHaveBeenCalledWith('e1');
  });

  it('opening the menu does not open the panel of the row', () => {
    const props = queueSetup();
    fireEvent.click(within(row('e1')).getByRole('button', { name: 'Ver fila de Claude Code' }));
    expect(props.onOpen).not.toHaveBeenCalled();
  });

  it('tells how many items were discarded and lets the user dismiss the notice', () => {
    const props = queueSetup({
      discarded: new Map([
        ['e2', 3],
        ['e3', 1],
      ]),
    });
    expect(within(row('e2')).getByRole('status').textContent).toMatch(/3 itens descartados/);
    expect(within(row('e3')).getByRole('status').textContent).toMatch(/1 item descartado\b/);
    expect(within(row('e1')).queryByRole('status')).toBeNull();
    fireEvent.click(within(row('e2')).getByRole('button', { name: 'Dispensar aviso da fila' }));
    expect(props.onDismissDiscarded).toHaveBeenCalledWith('e2');
  });
});

describe('Tree — command executions', () => {
  const commandTask: Task = { ...task('tc', 'g1', 'dev'), kind: 'command', isolation: 'direct' };
  const commandExec = execution('ec', {
    taskId: 'tc',
    agentId: 'command',
    model: null,
    permissionMode: null,
    status: 'running',
    command: { commandId: 'c1', label: 'dev', file: '/bin/node', args: ['server.js'] },
  });

  function commandSetup(over: Partial<TreeProps> = {}) {
    return setup({
      tasks: [commandTask],
      executions: [commandExec],
      onAddTerminal: vi.fn(),
      launchable: [agentDef('claude')],
      ...over,
    });
  }

  it('shows the command label with its own icon and no agent name', () => {
    commandSetup();
    const r = row('ec');
    expect(within(r).getByTestId('tree-exec-command-icon-ec')).toBeTruthy();
    expect(within(r).getByText('dev')).toBeTruthy();
    expect(within(r).queryByText('command')).toBeNull();
    expect(within(r).getByText('rodando')).toBeTruthy();
  });

  it('keeps the agent rows without the command icon', () => {
    setup();
    expect(within(row('e1')).queryByTestId('tree-exec-command-icon-e1')).toBeNull();
  });

  it('names the actions after the command and keeps the stop/relaunch rules', () => {
    const props = commandSetup();
    const r = row('ec');
    expect((within(r).getByRole('button', { name: 'Parar dev' }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(r).getByRole('button', { name: 'Relançar dev' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(within(r).getByRole('button', { name: 'Parar dev' }));
    expect(props.onStop).toHaveBeenCalledWith('ec');
  });

  it('does not offer a new agent terminal in a command session', () => {
    commandSetup();
    expect(screen.queryByRole('button', { name: /Novo terminal na sessão/ })).toBeNull();
  });
});
