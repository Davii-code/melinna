import { describe, expect, it, vi } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import { registerChat } from '../../../../src/main/ipc/register-chat';
import { handleRecorder } from '../../../support/fake-core';
import { MemoryLogger } from '../../../support/fakes/logger';
import { currentOs } from '../../../support/os';

const REPO = currentOs === 'win32' ? 'C:\\ws\\repo' : '/ws/repo';

function setup() {
  const chat = {
    start: vi.fn(async (_input: unknown) => ({ chatId: 'c1', agent: 'Claude Code' })),
    send: vi.fn((_chatId: string, _text: string) => undefined),
    stop: vi.fn((_chatId: string) => undefined),
    close: vi.fn((_chatId: string) => undefined),
  };
  const log = new MemoryLogger();
  const rec = handleRecorder();
  registerChat(rec.handle, { chat, roots: () => [REPO], os: currentOs, log });
  return { chat, log, rec };
}

describe('chat IPC', () => {
  it('registers every chat channel', () => {
    expect(setup().rec.channels()).toEqual(['chat:close', 'chat:send', 'chat:start', 'chat:stop']);
  });

  it('starts a chat only in the folder of an open workspace', async () => {
    const { rec, chat } = setup();
    expect(await rec.call('chat:start', { folder: REPO, permission: 'plan' })).toEqual({
      ok: true,
      value: { chatId: 'c1', agent: 'Claude Code' },
    });
    expect(chat.start).toHaveBeenCalledWith({ folder: REPO, permission: 'plan' });
    expect((await rec.call('chat:start', { folder: '/outro/lugar' })).error?.code).toBe('FILE_OUTSIDE_ROOT');
    expect(chat.start).toHaveBeenCalledTimes(1);
  });

  it('validates the start payload', async () => {
    const { rec, chat } = setup();
    for (const bad of [null, 'x', {}, { folder: 42 }, { folder: REPO, permission: '' }, { folder: REPO, permission: 7 }]) {
      expect((await rec.call('chat:start', bad)).error?.code).toBe('INPUT_INVALID');
    }
    expect(chat.start).not.toHaveBeenCalled();
  });

  it('sends, stops and closes with a validated chat id', async () => {
    const { rec, chat } = setup();
    expect((await rec.call('chat:send', 'c1', 'Olá')).ok).toBe(true);
    expect((await rec.call('chat:stop', 'c1')).ok).toBe(true);
    expect((await rec.call('chat:close', 'c1')).ok).toBe(true);
    expect(chat.send).toHaveBeenCalledWith('c1', 'Olá');
    expect((await rec.call('chat:send', '../x', 'Olá')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('chat:send', 'c1', '')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('chat:send', 'c1', 'x'.repeat(100_001))).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('chat:stop', 42)).error?.code).toBe('INPUT_INVALID');
    expect(chat.send).toHaveBeenCalledTimes(1);
  });

  it('passes on a refusal of the service and never logs the message', async () => {
    const { rec, chat, log } = setup();
    chat.send.mockImplementation(() => {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'O agente ainda está respondendo.' });
    });
    expect((await rec.call('chat:send', 'c1', 'texto sigiloso')).error?.message).toBe(
      'O agente ainda está respondendo.',
    );
    expect(log.text()).not.toContain('sigiloso');
  });
});
