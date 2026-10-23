import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { UsePromptDialog } from '../../../src/renderer/components/Prompts/UsePromptDialog';
import type { AgentDefinition, Execution, Task } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';
import { agentDef, execution, shellDef } from '../../support/renderer-fixtures';

const claude = agentDef('claude');
const bash = shellDef('bash', 'Bash');
const agents = new Map<string, AgentDefinition>([
  ['claude', claude],
  ['bash', bash],
]);

function task(id: string, title: string): Task {
  return {
    id,
    groupId: 'w1',
    title,
    prompt: '',
    repoPath: '/repos/site',
    repoId: 'r',
    baseRef: 'HEAD',
    baseCommit: '',
    slug: 's',
    createdAt: '2026-10-21T09:00:00.000Z',
    isolation: 'direct',
  };
}

const tasks = [task('t1', 'Sessão 1')];
const e1 = execution('e1', { taskId: 't1' });

interface Opts {
  body?: string;
  name?: string;
  prompt?: { name: string; body: string } | null;
  target?: string | null;
  executions?: Execution[];
}

function setup(opts: Opts = {}) {
  const api = fakeApi();
  const onClose = vi.fn();
  const prompt = 'prompt' in opts ? opts.prompt : { name: opts.name ?? 'Revisar', body: opts.body ?? 'Revise {{arquivo}}' };
  render(
    <ApiContext.Provider value={api}>
      <UsePromptDialog
        prompt={prompt ?? null}
        targetExecId={opts.target === undefined ? 'e1' : opts.target}
        executions={opts.executions ?? [e1]}
        tasks={tasks}
        agents={agents}
        onClose={onClose}
      />
    </ApiContext.Provider>,
  );
  return { api, onClose };
}

const send = () => screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement;

describe('UsePromptDialog', () => {
  it('asks once for each variable, even when repeated, and marks the automatic ones', () => {
    setup({ body: 'Revise {{arquivo}} em {{arquivo}}, pasta {{pasta}}, ws {{workspace}}, em {{data}}' });
    expect(screen.getAllByLabelText('arquivo')).toHaveLength(1);
    expect(screen.queryByLabelText('pasta')).toBeNull();
    const auto = screen.getByText(/Preenchidas sozinhas/);
    expect(auto.textContent).toMatch(/\{\{pasta\}\}/);
    expect(auto.textContent).toMatch(/\{\{workspace\}\}/);
    expect(auto.textContent).toMatch(/\{\{data\}\}/);
  });

  it('treats invalid names as plain text', () => {
    setup({ body: 'Texto {{a-b}} e {{ }}' });
    expect(screen.queryByRole('textbox', { name: /a-b/ })).toBeNull();
    expect(send().disabled).toBe(false);
  });

  it('blocks sending until every variable is filled', () => {
    setup();
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a.ts' } });
    expect(send().disabled).toBe(false);
  });

  it('lets a variable stay empty only when marked', () => {
    setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deixar {{arquivo}} vazia' }));
    expect(send().disabled).toBe(false);
    expect((screen.getByLabelText('arquivo') as HTMLInputElement).disabled).toBe(true);
  });

  it('sends the body, the values and the focused session, then closes', async () => {
    const { api, onClose } = setup();
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a.ts' } });
    fireEvent.click(send());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('Prompt enviado.'));
    expect(api.prompts.send).toHaveBeenCalledWith({
      body: 'Revise {{arquivo}}',
      values: { arquivo: 'a.ts' },
      allowEmpty: [],
      execIds: ['e1'],
    });
  });

  it('sends the names left empty in allowEmpty', async () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deixar {{arquivo}} vazia' }));
    fireEvent.click(send());
    await waitFor(() => expect(api.prompts.send).toHaveBeenCalled());
    expect(api.prompts.send.mock.calls[0]?.[0]).toMatchObject({ values: {}, allowEmpty: ['arquivo'] });
  });

  it('sends a prompt without variables straight away', async () => {
    const { api, onClose } = setup({ body: 'Explique o projeto' });
    fireEvent.click(send());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.prompts.send.mock.calls[0]?.[0]).toMatchObject({ body: 'Explique o projeto', values: {} });
  });

  it('previews the final text for the focused session without sending', async () => {
    const { api } = setup();
    api.prompts.preview.mockImplementation(() => okR('Revise a.ts'));
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a.ts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prévia' }));
    expect((await screen.findByLabelText('Prévia do texto')).textContent).toBe('Revise a.ts');
    expect(api.prompts.preview).toHaveBeenCalledWith({
      body: 'Revise {{arquivo}}',
      values: { arquivo: 'a.ts' },
      allowEmpty: [],
      execId: 'e1',
    });
    expect(api.prompts.send).not.toHaveBeenCalled();
  });

  it('shows the error from the main process and stays open', async () => {
    const { api, onClose } = setup();
    api.prompts.send.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'O prompt contém caracteres de controle; remova-os.' },
      }),
    );
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a' } });
    fireEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toBe('O prompt contém caracteres de controle; remova-os.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['not-running', 'Não enviado: sessão encerrada'],
    ['not-ready', 'Não enviado: sessão ainda iniciando'],
    ['not-found', 'Não enviado: sessão removida'],
    ['failed', 'Não enviado: falha ao escrever no terminal'],
  ] as const)('explains a %s result and stays open', async (status, message) => {
    const { api, onClose } = setup({ body: 'oi' });
    api.prompts.send.mockImplementation(() => okR([{ execId: 'e1', status }]));
    fireEvent.click(send());
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('warns that text sent to a shell runs as a command', () => {
    setup({
      body: 'ls',
      executions: [execution('e1', { taskId: 't1', agentId: 'bash', permissionMode: null, model: null })],
    });
    expect(screen.getByRole('status').textContent).toMatch(/será executado como comando/);
  });

  it('does not warn for an agent session', () => {
    setup({ body: 'oi' });
    expect(screen.queryByText(/executado como comando/)).toBeNull();
  });

  it('cannot send without a session in focus', () => {
    setup({ target: null, body: 'oi', executions: [] });
    expect(send().disabled).toBe(true);
    expect(screen.getByText(/Nenhuma sessão em foco/)).toBeTruthy();
  });

  it('sends a free text typed in the dialog', async () => {
    const { api, onClose } = setup({ prompt: null });
    expect(send().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'rode os testes' } });
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.prompts.send.mock.calls[0]?.[0]).toMatchObject({ body: 'rode os testes', execIds: ['e1'] });
  });

  it('names the destination session', () => {
    setup({ body: 'oi' });
    expect(screen.getByText(/Claude Code · Sessão 1/)).toBeTruthy();
  });

  it('closes with Cancel and with Esc', () => {
    const { onClose } = setup({ body: 'oi' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('UsePromptDialog: várias sessões', () => {
  const titles = ['Alfa', 'Beta', 'Gama', 'Delta', 'Épsilon'];
  const manyTasks = titles.map((title, i) => task(`t${i + 1}`, title));
  const manyExecs = titles.map((_, i) => execution(`e${i + 1}`, { taskId: `t${i + 1}` }));

  function setupMany(over: { executions?: Execution[]; body?: string; target?: string | null } = {}) {
    const api = fakeApi();
    const onClose = vi.fn();
    render(
      <ApiContext.Provider value={api}>
        <UsePromptDialog
          prompt={{ name: 'Revisar', body: over.body ?? 'oi' }}
          targetExecId={over.target === undefined ? 'e1' : over.target}
          executions={over.executions ?? manyExecs}
          tasks={manyTasks}
          agents={agents}
          onClose={onClose}
        />
      </ApiContext.Provider>,
    );
    return { api, onClose };
  }

  const many = () => fireEvent.click(screen.getByRole('radio', { name: 'Várias sessões' }));
  const pick = (label: RegExp) => fireEvent.click(screen.getByRole('checkbox', { name: label }));

  it('lists only the live sessions, with the focused one already marked', () => {
    setupMany({
      executions: [...manyExecs.slice(0, 2), execution('e3', { taskId: 't3', status: 'exited' })],
    });
    many();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Claude Code · Alfa',
      'Claude Code · Beta',
    ]);
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
  });

  it('cannot send with no session marked', () => {
    setupMany();
    many();
    pick(/Alfa/);
    expect(send().disabled).toBe(true);
  });

  it('sends straight away when only one session is marked', async () => {
    const { api, onClose } = setupMany();
    many();
    pick(/Gama/);
    pick(/Alfa/);
    fireEvent.click(send());
    await waitFor(() => expect(api.prompts.send).toHaveBeenCalled());
    expect(api.prompts.send.mock.calls[0]?.[0]).toMatchObject({ execIds: ['e3'] });
    expect(onClose).toHaveBeenCalledWith('Prompt enviado.');
  });

  it('asks for confirmation listing how many and which sessions before sending to several', async () => {
    const { api } = setupMany();
    many();
    pick(/Beta/);
    pick(/Gama/);
    fireEvent.click(send());
    const confirmation = await screen.findByRole('alertdialog', { name: 'Enviar para 3 sessões?' });
    expect(api.prompts.send).not.toHaveBeenCalled();
    expect(confirmation.textContent).toMatch(/Claude Code · Alfa/);
    expect(confirmation.textContent).toMatch(/Claude Code · Beta/);
    expect(confirmation.textContent).toMatch(/Claude Code · Gama/);
    expect(confirmation.textContent).not.toMatch(/Delta/);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.prompts.send).not.toHaveBeenCalled();
  });

  it('sends to the confirmed sessions in a single call', async () => {
    const { api } = setupMany({ body: 'Revise {{arquivo}}' });
    many();
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a.ts' } });
    pick(/Beta/);
    fireEvent.click(send());
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar envio' }));
    await waitFor(() => expect(api.prompts.send).toHaveBeenCalledTimes(1));
    expect(api.prompts.send).toHaveBeenCalledWith({
      body: 'Revise {{arquivo}}',
      values: { arquivo: 'a.ts' },
      allowEmpty: [],
      execIds: ['e1', 'e2'],
    });
  });

  it('flags a shell session and a session without confirmations in the confirmation', async () => {
    setupMany({
      executions: [
        execution('e1', { taskId: 't1' }),
        execution('e2', { taskId: 't2', agentId: 'bash', permissionMode: null, model: null }),
        execution('e3', { taskId: 't3', permissionMode: 'bypass' }),
      ],
    });
    many();
    pick(/Beta/);
    pick(/Gama/);
    fireEvent.click(send());
    const confirmation = await screen.findByRole('alertdialog');
    const rows = Array.from(confirmation.querySelectorAll('li')).map((li) => li.textContent ?? '');
    expect(rows[0]).not.toMatch(/comando|sem confirmações/);
    expect(rows[1]).toMatch(/Bash · Beta.*executado como comando/);
    expect(rows[2]).toMatch(/Claude Code · Gama.*sem confirmações/);
    expect(confirmation.querySelector('.target-warn')).not.toBeNull();
  });

  it('flags the same risks next to the sessions while choosing', () => {
    setupMany({
      executions: [
        execution('e1', { taskId: 't1' }),
        execution('e2', { taskId: 't2', agentId: 'bash', permissionMode: null, model: null }),
        execution('e3', { taskId: 't3', permissionMode: 'bypass' }),
      ],
    });
    many();
    const text = screen.getByRole('group', { name: 'Sessões de destino' }).textContent ?? '';
    expect(text).toMatch(/shell/);
    expect(text).toMatch(/sem confirmações/);
  });

  it('shows the result per session with each of the five statuses', async () => {
    const { api, onClose } = setupMany();
    api.prompts.send.mockImplementation(() =>
      okR([
        { execId: 'e1', status: 'sent' as const },
        { execId: 'e2', status: 'not-running' as const },
        { execId: 'e3', status: 'not-ready' as const },
        { execId: 'e4', status: 'not-found' as const },
        { execId: 'e5', status: 'failed' as const },
      ]),
    );
    many();
    for (const label of [/Beta/, /Gama/, /Delta/, /Épsilon/]) pick(label);
    fireEvent.click(send());
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar envio' }));
    const result = await screen.findByRole('region', { name: 'Resultado do envio' });
    const rows = Array.from(result.querySelectorAll('li')).map((li) => li.textContent);
    expect(rows).toEqual([
      'Claude Code · Alfa: Enviado',
      'Claude Code · Beta: Não enviado: sessão encerrada',
      'Claude Code · Gama: Não enviado: sessão ainda iniciando',
      'Claude Code · Delta: Não enviado: sessão removida',
      'Claude Code · Épsilon: Não enviado: falha ao escrever no terminal',
    ]);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledWith('Prompt enviado para 1 de 5 sessões.');
  });

  it('shows the result per session even when every session got the text', async () => {
    const { api, onClose } = setupMany();
    many();
    pick(/Beta/);
    fireEvent.click(send());
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar envio' }));
    const result = await screen.findByRole('region', { name: 'Resultado do envio' });
    expect(result.textContent).toMatch(/Alfa: Enviado/);
    expect(result.textContent).toMatch(/Beta: Enviado/);
    expect(api.prompts.send).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClose).toHaveBeenCalledWith('Prompt enviado para 2 sessões.');
  });

  it('keeps the dialog open and shows the error when the main process refuses', async () => {
    const { api, onClose } = setupMany();
    api.prompts.send.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'INPUT_INVALID' as const, message: 'Valor inválido.' },
      }),
    );
    many();
    pick(/Beta/);
    fireEvent.click(send());
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar envio' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Valor inválido.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('UsePromptDialog: enfileirar', () => {
  const manyTasks = [task('t1', 'Alfa'), task('t2', 'Beta')];
  const execs = [execution('e1', { taskId: 't1' }), execution('e2', { taskId: 't2' })];

  function setupQueue(over: { body?: string; target?: string | null; executions?: Execution[] } = {}) {
    const api = fakeApi();
    const onClose = vi.fn();
    render(
      <ApiContext.Provider value={api}>
        <UsePromptDialog
          prompt={{ name: 'Revisar', body: over.body ?? 'oi' }}
          targetExecId={over.target === undefined ? 'e1' : over.target}
          executions={over.executions ?? execs}
          tasks={manyTasks}
          agents={agents}
          onClose={onClose}
        />
      </ApiContext.Provider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Enfileirar' }));
    return { api, onClose };
  }

  const enqueue = () => screen.getByRole('button', { name: 'Enfileirar' }) as HTMLButtonElement;

  it('offers the live sessions, with the focused one chosen, and renames the submit button', () => {
    setupQueue();
    const select = screen.getByLabelText('Sessão da fila') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Claude Code · Alfa',
      'Claude Code · Beta',
    ]);
    expect(select.value).toBe('e1');
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
  });

  it('queues for the chosen session and tells how many are waiting', async () => {
    const { api, onClose } = setupQueue({ body: 'Revise {{arquivo}}' });
    api.prompts.queue.enqueue.mockImplementation(() =>
      okR([{ id: 'q1', text: 'Revise a.ts', enqueuedAt: '2026-10-22T10:00:00.000Z' }]),
    );
    fireEvent.change(screen.getByLabelText('Sessão da fila'), { target: { value: 'e2' } });
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a.ts' } });
    fireEvent.click(enqueue());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('Prompt na fila (1 na fila).'));
    expect(api.prompts.queue.enqueue).toHaveBeenCalledWith({
      body: 'Revise {{arquivo}}',
      values: { arquivo: 'a.ts' },
      allowEmpty: [],
      execId: 'e2',
    });
    expect(api.prompts.send).not.toHaveBeenCalled();
  });

  it('says it was sent when the session was idle and the queue empty', async () => {
    const { api, onClose } = setupQueue();
    api.prompts.queue.enqueue.mockImplementation(() => okR([]));
    fireEvent.click(enqueue());
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('Prompt enviado.'));
  });

  it('blocks queuing while a variable is missing', () => {
    setupQueue({ body: 'Revise {{arquivo}}' });
    expect(enqueue().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('arquivo'), { target: { value: 'a' } });
    expect(enqueue().disabled).toBe(false);
  });

  it('shows the error and stays open', async () => {
    const { api, onClose } = setupQueue();
    api.prompts.queue.enqueue.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'EXECUTION_NOT_RUNNING' as const, message: 'A execução não está rodando.' },
      }),
    );
    fireEvent.click(enqueue());
    expect((await screen.findByRole('alert')).textContent).toBe('A execução não está rodando.');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('previews for the chosen session', async () => {
    const { api } = setupQueue();
    fireEvent.change(screen.getByLabelText('Sessão da fila'), { target: { value: 'e2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prévia' }));
    await waitFor(() => expect(api.prompts.preview).toHaveBeenCalled());
    expect(api.prompts.preview.mock.calls[0]?.[0]).toMatchObject({ execId: 'e2' });
  });

  it('cannot queue without a live session', () => {
    setupQueue({ executions: [execution('e1', { taskId: 't1', status: 'exited' })], target: null });
    expect(enqueue().disabled).toBe(true);
    expect(screen.getByText('Nenhuma sessão viva')).toBeTruthy();
  });

  it('warns when the chosen session is a shell', () => {
    setupQueue({
      executions: [execution('e1', { taskId: 't1', agentId: 'bash', permissionMode: null, model: null })],
    });
    expect(screen.getByRole('status').textContent).toMatch(/será executado como comando/);
  });
});
