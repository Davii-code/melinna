import { describe, expect, it } from 'vitest';
import type { ChatLaunch } from '../../../../src/core/catalog/catalog-service';
import type { AgentDefinition } from '../../../../src/core/catalog/schema';
import { ChatService } from '../../../../src/core/chat/chat-service';
import { parseClaudeLine } from '../../../../src/core/chat/claude-stream';
import { CHAT_MAX_OPEN, type ChatEventEnvelope } from '../../../../src/core/chat/types';
import type { MelinnaError } from '../../../../src/core/errors';
import type { ProcessRunner, RunOptions, RunResult } from '../../../../src/core/ports/process-runner';
import { MemoryLogger } from '../../../support/fakes/logger';

const AGENT: AgentDefinition = {
  id: 'claude',
  displayName: 'Claude Code',
  kind: 'agent',
  executable: { command: 'claude' },
  args: [],
  prompt: { delivery: 'argument', args: ['{prompt}'] },
  chat: { format: 'claude-stream-json', args: ['-p'], resumeArgs: ['--resume'] },
  detect: { strategy: 'path' },
};
const LAUNCH: ChatLaunch = { agent: AGENT, file: '/bin/claude', args: ['-p', '--mode', 'plan'], resumeArgs: ['--resume'] };

const init = (id: string) => JSON.stringify({ type: 'system', subtype: 'init', session_id: id });
const say = (text: string) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (name: string, input: unknown) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const result = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', result: 'fim', ...over });

const enc = new TextEncoder();
const done = (exitCode = 0, stderr = ''): RunResult => ({
  exitCode,
  stdout: new Uint8Array(),
  stderr: enc.encode(stderr),
});

interface Call {
  file: string;
  args: string[];
  opts: RunOptions;
}

function setup(launch: ChatLaunch | null = LAUNCH) {
  const calls: Call[] = [];
  const events: ChatEventEnvelope[] = [];
  const permissions: Array<string | undefined> = [];
  let behavior: (call: Call) => Promise<RunResult> = async (call) => {
    call.opts.onStdout?.(`${init('s1')}\n${say('Olá')}\n${result()}\n`);
    return done();
  };
  const runner: ProcessRunner = {
    run: (file, args, opts) => {
      const call = { file, args: [...args], opts };
      calls.push(call);
      return behavior(call);
    },
  };
  let n = 0;
  const log = new MemoryLogger();
  const service = new ChatService({
    catalog: {
      chatLaunch: async (permission) => {
        permissions.push(permission);
        return launch;
      },
    },
    runner,
    log,
    emit: (e) => void events.push(e),
    newId: () => `c${++n}`,
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    service,
    calls,
    events,
    permissions,
    log,
    settle,
    respond: (fn: typeof behavior) => {
      behavior = fn;
    },
  };
}

function thrown(fn: () => unknown): MelinnaError {
  try {
    fn();
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('deveria ter falhado');
}

describe('parseClaudeLine', () => {
  it('reads the session, text, tool use and the end of the answer', () => {
    expect(parseClaudeLine(init('abc'))).toEqual([{ kind: 'session', sessionId: 'abc' }]);
    expect(parseClaudeLine(say('Olá'))).toEqual([{ kind: 'text', text: 'Olá' }]);
    expect(parseClaudeLine(use('Edit', { file_path: 'src/a.ts', old_string: 'x' }))).toEqual([
      { kind: 'tool', name: 'Edit', summary: 'src/a.ts' },
    ]);
    expect(parseClaudeLine(use('Bash', { command: 'npm   test\n--run' }))).toEqual([
      { kind: 'tool', name: 'Bash', summary: 'npm test --run' },
    ]);
    expect(parseClaudeLine(result())).toEqual([
      { kind: 'session', sessionId: 's1' },
      { kind: 'done', ok: true },
    ]);
  });

  it('reports a failed result with its text', () => {
    expect(parseClaudeLine(result({ subtype: 'error_max_turns', is_error: true, result: 'Limite de turnos.' }))).toEqual([
      { kind: 'session', sessionId: 's1' },
      { kind: 'done', ok: false, error: 'Limite de turnos.' },
    ]);
    expect(parseClaudeLine(result({ is_error: true, result: '' })).at(-1)).toEqual({
      kind: 'done',
      ok: false,
      error: 'O agente terminou com erro.',
    });
  });

  it('ignores hooks, tool results, rate limit events, blank lines and garbage', () => {
    for (const line of [
      '',
      '   ',
      'não é json',
      '[]',
      JSON.stringify({ type: 'system', subtype: 'hook_started', session_id: 'x' }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
      JSON.stringify({ type: 'rate_limit_event' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '' }] } }),
    ]) {
      expect(parseClaudeLine(line)).toEqual([]);
    }
  });

  it('cuts a long tool summary', () => {
    const [event] = parseClaudeLine(use('Bash', { command: 'x'.repeat(500) }));
    expect(event).toMatchObject({ kind: 'tool' });
    expect(event && event.kind === 'tool' && event.summary.length).toBe(161);
  });
});

describe('ChatService', () => {
  it('starts a chat with the chosen permission mode and names the agent', async () => {
    const { service, permissions } = setup();
    expect(await service.start({ folder: '/repo', permission: 'plan' })).toEqual({
      chatId: 'c1',
      agent: 'Claude Code',
    });
    expect(permissions).toEqual(['plan']);
  });

  it('fails when no agent can chat', async () => {
    const { service } = setup(null);
    await expect(service.start({ folder: '/repo' })).rejects.toMatchObject({ code: 'PROGRAM_NOT_FOUND' });
  });

  it('limits the open chats and frees a slot on close', async () => {
    const { service } = setup();
    for (let i = 0; i < CHAT_MAX_OPEN; i++) await service.start({ folder: '/repo' });
    await expect(service.start({ folder: '/repo' })).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    service.close('c1');
    await expect(service.start({ folder: '/repo' })).resolves.toMatchObject({ agent: 'Claude Code' });
  });

  it('runs the agent in the folder with the message on stdin and publishes the events in order', async () => {
    const { service, calls, events, settle } = setup();
    await service.start({ folder: '/repo' });
    service.send('c1', 'Oi\r\ntudo bem?');
    await settle();
    expect(calls[0]?.file).toBe('/bin/claude');
    expect(calls[0]?.args).toEqual(['-p', '--mode', 'plan']);
    expect(calls[0]?.opts.cwd).toBe('/repo');
    expect(new TextDecoder().decode(calls[0]?.opts.stdin)).toBe('Oi\ntudo bem?');
    expect(events).toEqual([
      { chatId: 'c1', kind: 'session', sessionId: 's1' },
      { chatId: 'c1', kind: 'text', text: 'Olá' },
      { chatId: 'c1', kind: 'session', sessionId: 's1' },
      { chatId: 'c1', kind: 'done', ok: true },
    ]);
  });

  it('resumes the session of the agent from the second message on', async () => {
    const { service, calls, settle } = setup();
    await service.start({ folder: '/repo' });
    service.send('c1', 'primeira');
    await settle();
    service.send('c1', 'segunda');
    await settle();
    expect(calls[1]?.args).toEqual(['-p', '--mode', 'plan', '--resume', 's1']);
  });

  it('joins lines split across chunks', async () => {
    const { service, events, settle, respond } = setup();
    const line = say('texto inteiro');
    respond(async (call) => {
      call.opts.onStdout?.(line.slice(0, 20));
      call.opts.onStdout?.(`${line.slice(20)}\n${result().slice(0, 10)}`);
      call.opts.onStdout?.(result().slice(10));
      return done();
    });
    await service.start({ folder: '/repo' });
    service.send('c1', 'oi');
    await settle();
    expect(events.map((e) => e.kind)).toEqual(['text', 'session', 'done']);
    expect(events[0]).toMatchObject({ text: 'texto inteiro' });
  });

  it('refuses a second message while the first is being answered, and bad messages', async () => {
    const { service, respond } = setup();
    respond(() => new Promise(() => undefined));
    await service.start({ folder: '/repo' });
    service.send('c1', 'oi');
    expect(thrown(() => service.send('c1', 'de novo')).userMessage).toBe('O agente ainda está respondendo.');
    expect(thrown(() => service.send('nao-existe', 'oi')).userMessage).toBe('Conversa não encontrada.');
    await service.start({ folder: '/repo' });
    expect(thrown(() => service.send('c2', '   ')).userMessage).toBe('Escreva a mensagem.');
    expect(thrown(() => service.send('c2', 'x\x1b[2J')).userMessage).toMatch(/controle/);
    expect(thrown(() => service.send('c2', 'x'.repeat(100_001))).code).toBe('INPUT_INVALID');
  });

  it('always ends an answer with exactly one done: process failure, silence, timeout, spawn error', async () => {
    const cases: Array<[(call: Call) => Promise<RunResult>, string]> = [
      [async () => done(1, 'Invalid API key\n'), 'Claude Code falhou: Invalid API key'],
      [async () => done(0), 'O agente terminou sem responder.'],
      [async () => Promise.reject(Object.assign(new Error('t'), { code: 'ETIMEDOUT' })), 'O agente demorou demais para responder.'],
      [async () => Promise.reject(new Error('ENOENT')), 'Não foi possível executar Claude Code.'],
    ];
    for (const [behavior, error] of cases) {
      const { service, events, settle, respond } = setup();
      respond(behavior);
      await service.start({ folder: '/repo' });
      service.send('c1', 'oi');
      await settle();
      expect(events).toEqual([{ chatId: 'c1', kind: 'done', ok: false, error }]);
    }
  });

  it('does not add a second done after the result of the agent', async () => {
    const { service, events, settle, respond } = setup();
    respond(async (call) => {
      call.opts.onStdout?.(`${result()}\n`);
      return done(1, 'aviso tardio');
    });
    await service.start({ folder: '/repo' });
    service.send('c1', 'oi');
    await settle();
    expect(events.filter((e) => e.kind === 'done')).toEqual([{ chatId: 'c1', kind: 'done', ok: true }]);
  });

  it('stop aborts the answer and the chat accepts the next message', async () => {
    const { service, events, settle, respond } = setup();
    respond(
      (call) =>
        new Promise((_resolve, reject) => {
          call.opts.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('cancelada'), { name: 'AbortError' })),
          );
        }),
    );
    await service.start({ folder: '/repo' });
    service.send('c1', 'oi');
    service.stop('c1');
    await settle();
    expect(events).toEqual([{ chatId: 'c1', kind: 'done', ok: false, error: 'Resposta interrompida.' }]);
    respond(async () => done(0));
    expect(() => service.send('c1', 'de novo')).not.toThrow();
  });

  it('close aborts the answer and publishes nothing more', async () => {
    const { service, events, settle, respond, calls } = setup();
    respond(
      (call) =>
        new Promise((_resolve, reject) => {
          call.opts.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('cancelada'), { name: 'AbortError' })),
          );
        }),
    );
    await service.start({ folder: '/repo' });
    service.send('c1', 'oi');
    service.close('c1');
    service.close('c1');
    await settle();
    expect(calls[0]?.opts.signal?.aborted).toBe(true);
    expect(events).toEqual([]);
    expect(thrown(() => service.send('c1', 'oi')).userMessage).toBe('Conversa não encontrada.');
  });

  it('never logs the messages', async () => {
    const { service, log, settle } = setup();
    await service.start({ folder: '/repo' });
    service.send('c1', 'minha senha é 1234');
    await settle();
    expect(log.text()).not.toContain('1234');
    expect(log.text()).not.toContain('Olá');
  });
});
