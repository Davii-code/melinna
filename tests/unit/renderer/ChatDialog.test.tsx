import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { ChatDialog } from '../../../src/renderer/components/Chat/ChatDialog';
import type { AgentDefinition } from '../../../src/shared/ipc-contract';
import { fakeApi } from '../../support/fake-api';
import { agentDef } from '../../support/renderer-fixtures';

const AGENT: AgentDefinition = agentDef('claude', {
  chat: { format: 'claude-stream-json', args: ['-p'], resumeArgs: ['--resume'] },
  permission: {
    options: [
      { id: 'manual', label: 'Perguntar', args: [] },
      { id: 'acceptEdits', label: 'Aceitar edições', args: [] },
      { id: 'bypass', label: 'Sem confirmações', args: [], dangerous: true },
    ],
    default: 'manual',
    switch: { strategy: 'restart-resume' },
  },
});

const FOLDERS = [
  { path: '/repos/site', name: 'site' },
  { path: '/repos/api', name: 'api' },
];

function setup(over: { agent?: AgentDefinition | undefined; folders?: typeof FOLDERS } = {}) {
  const api = fakeApi();
  const onClose = vi.fn();
  const view = render(
    <ApiContext.Provider value={api}>
      <ChatDialog
        folders={over.folders ?? FOLDERS}
        agent={'agent' in over ? over.agent : AGENT}
        onClose={onClose}
      />
    </ApiContext.Provider>,
  );
  return { api, onClose, ...view };
}

const box = () => screen.getByLabelText('Mensagem') as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement;

async function say(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.click(sendButton());
  await waitFor(() => expect(box().value).toBe(''));
}

describe('ChatDialog', () => {
  it('offers the workspace folders and only the safe permission modes', () => {
    setup();
    const folder = screen.getByLabelText('Pasta') as HTMLSelectElement;
    expect(Array.from(folder.options).map((o) => o.value)).toEqual(['/repos/site', '/repos/api']);
    const mode = screen.getByLabelText('Modo de permissão') as HTMLSelectElement;
    expect(Array.from(mode.options).map((o) => o.value)).toEqual(['manual', 'acceptEdits']);
    expect(mode.value).toBe('manual');
    expect(screen.getByText(/não tem como pedir confirmação/)).toBeTruthy();
  });

  it('starts the chat on the first message, with the chosen folder and mode', async () => {
    const { api } = setup();
    fireEvent.change(screen.getByLabelText('Pasta'), { target: { value: '/repos/api' } });
    fireEvent.change(screen.getByLabelText('Modo de permissão'), { target: { value: 'acceptEdits' } });
    await say('Liste os endpoints');
    expect(api.chat.start).toHaveBeenCalledWith({ folder: '/repos/api', permission: 'acceptEdits' });
    expect(api.chat.send).toHaveBeenCalledWith('c1', 'Liste os endpoints');
    expect(screen.getByText('Liste os endpoints')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/respondendo/);
    expect((screen.getByLabelText('Pasta') as HTMLSelectElement).disabled).toBe(true);
  });

  it('shows the answer, the tools used and the end, and reuses the chat on the next message', async () => {
    const { api } = setup();
    await say('Oi');
    act(() => {
      api.emitChatEvent({ chatId: 'c1', kind: 'tool', name: 'Read', summary: 'src/a.ts' });
      api.emitChatEvent({ chatId: 'c1', kind: 'text', text: 'Encontrei o arquivo.' });
      api.emitChatEvent({ chatId: 'c1', kind: 'done', ok: true });
    });
    expect(screen.getByText('Read: src/a.ts')).toBeTruthy();
    expect(screen.getByText('Encontrei o arquivo.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    await say('E agora?');
    expect(api.chat.start).toHaveBeenCalledTimes(1);
    expect(api.chat.send).toHaveBeenLastCalledWith('c1', 'E agora?');
  });

  it('shows a failed answer and ignores events of other chats', async () => {
    const { api } = setup();
    await say('Oi');
    act(() => {
      api.emitChatEvent({ chatId: 'outro', kind: 'text', text: 'não é daqui' });
      api.emitChatEvent({ chatId: 'c1', kind: 'done', ok: false, error: 'Resposta interrompida.' });
    });
    expect(screen.queryByText('não é daqui')).toBeNull();
    expect(screen.getByText('Resposta interrompida.')).toBeTruthy();
  });

  it('stops the answer in progress', async () => {
    const { api } = setup();
    await say('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    expect(api.chat.stop).toHaveBeenCalledWith('c1');
    expect(sendButton().disabled).toBe(true);
  });

  it('keeps the message and shows the reason when sending fails', async () => {
    const { api } = setup();
    api.chat.start.mockImplementation(
      () =>
        Promise.resolve({
          ok: false,
          error: { code: 'PROGRAM_NOT_FOUND', message: 'Nenhum agente instalado tem modo de chat.' },
        }) as never,
    );
    fireEvent.change(box(), { target: { value: 'Oi' } });
    fireEvent.click(sendButton());
    expect((await screen.findByRole('alert')).textContent).toBe('Nenhum agente instalado tem modo de chat.');
    expect(box().value).toBe('Oi');
    expect(api.chat.send).not.toHaveBeenCalled();
  });

  it('starts over with Nova conversa and closes the chat with the dialog', async () => {
    const { api, unmount } = setup();
    await say('Oi');
    fireEvent.click(screen.getByRole('button', { name: 'Nova conversa' }));
    expect(api.chat.close).toHaveBeenCalledWith('c1');
    expect(screen.queryByText('Oi')).toBeNull();
    expect((screen.getByLabelText('Pasta') as HTMLSelectElement).disabled).toBe(false);
    await say('De novo');
    expect(api.chat.start).toHaveBeenCalledTimes(2);
    unmount();
    expect(api.chat.close).toHaveBeenCalledTimes(2);
  });

  it('explains what is missing without an agent or without a workspace', () => {
    const none = setup({ agent: undefined });
    expect(screen.getByText(/Nenhum agente instalado tem modo de chat/)).toBeTruthy();
    expect(sendButton().disabled).toBe(true);
    none.unmount();
    setup({ folders: [] });
    expect(screen.getByText(/Abra um workspace primeiro/)).toBeTruthy();
  });
});
