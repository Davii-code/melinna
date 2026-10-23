import { describe, expect, it, vi } from 'vitest';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { PromptSender } from '../../../../src/core/prompts/prompt-sender';
import type { Execution, Group, Task } from '../../../../src/core/persistence/state-schema';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryLogger } from '../../../support/fakes/logger';

const decoder = new TextDecoder();

function setup() {
  const clock = new FakeClock(new Date(2026, 9, 22, 15, 30).getTime());
  const log = new MemoryLogger();
  const groups: Record<string, Group> = {
    g1: { id: 'g1', name: 'Site', order: 0 },
    g2: { id: 'g2', name: 'API', order: 1 },
  };
  const tasks: Record<string, Task> = {
    t1: { id: 't1', groupId: 'g1', repoPath: '/repos/site' } as Task,
    t2: { id: 't2', groupId: 'g2', repoPath: '/repos/api' } as Task,
  };
  const execs: Record<string, Execution> = {
    e1: { id: 'e1', taskId: 't1', status: 'idle', worktreePath: '/repos/site' } as Execution,
    e2: { id: 'e2', taskId: 't2', status: 'running', worktreePath: '/repos/api' } as Execution,
    legacy: {
      id: 'legacy',
      taskId: 't1',
      status: 'idle',
      worktreePath: '/data/worktrees/r1/legacy',
    } as Execution,
    booting: { id: 'booting', taskId: 't1', status: 'starting', worktreePath: '/repos/site' } as Execution,
    preparing: { id: 'preparing', taskId: 't1', status: 'preparing', worktreePath: '/repos/site' } as Execution,
    done: { id: 'done', taskId: 't1', status: 'exited', worktreePath: '/repos/site' } as Execution,
    lost: { id: 'lost', taskId: 't1', status: 'lost', worktreePath: '/repos/site' } as Execution,
    failed: { id: 'failed', taskId: 't1', status: 'failed_to_start', worktreePath: '/repos/site' } as Execution,
  };
  const writes: { execId: string; text: string }[] = [];
  const write = vi.fn((execId: string, data: Uint8Array) => {
    writes.push({ execId, text: decoder.decode(data) });
  });
  const sender = new PromptSender({
    model: {
      execution: (id) => execs[id],
      task: (id) => tasks[id],
      group: (id) => groups[id],
    },
    executions: { write },
    clock,
    log,
    mutex: new KeyedMutex(),
  });
  return { sender, writes, write, log, execs };
}

const input = (over: Partial<Parameters<PromptSender['send']>[0]> = {}) => ({
  body: 'Oi',
  values: {},
  allowEmpty: [],
  execIds: ['e1'],
  ...over,
});

describe('PromptSender.send', () => {
  it('writes the text plus Enter, as typed input', async () => {
    const { sender, writes } = setup();
    expect(await sender.send(input())).toEqual([{ execId: 'e1', status: 'sent' }]);
    expect(writes).toEqual([{ execId: 'e1', text: 'Oi\r' }]);
  });

  it('wraps a multi-line text in bracketed paste and confirms once', async () => {
    const { sender, writes } = setup();
    await sender.send(input({ body: 'linha 1\nlinha 2' }));
    expect(writes).toEqual([{ execId: 'e1', text: '\x1b[200~linha 1\rlinha 2\x1b[201~\r' }]);
  });

  it('resolves per target: each session gets its own folder and workspace', async () => {
    const { sender, writes } = setup();
    const results = await sender.send(
      input({ body: '{{pasta}} em {{workspace}} ({{data}}) {{arquivo}}', values: { arquivo: 'a.ts' }, execIds: ['e1', 'e2'] }),
    );
    expect(results.map((r) => r.status)).toEqual(['sent', 'sent']);
    expect(writes).toEqual([
      { execId: 'e1', text: '/repos/site em Site (2026-10-22) a.ts\r' },
      { execId: 'e2', text: '/repos/api em API (2026-10-22) a.ts\r' },
    ]);
  });

  it('uses the worktree folder for a legacy session', async () => {
    const { sender, writes } = setup();
    await sender.send(input({ body: '{{pasta}}', execIds: ['legacy'] }));
    expect(writes[0]?.text).toBe('/data/worktrees/r1/legacy\r');
  });

  it('reports a status per target and still delivers to the live ones', async () => {
    const { sender, writes } = setup();
    const results = await sender.send(
      input({ execIds: ['e1', 'done', 'booting', 'preparing', 'nope', 'lost', 'failed', 'e2'] }),
    );
    expect(results).toEqual([
      { execId: 'e1', status: 'sent' },
      { execId: 'done', status: 'not-running' },
      { execId: 'booting', status: 'not-ready' },
      { execId: 'preparing', status: 'not-ready' },
      { execId: 'nope', status: 'not-found' },
      { execId: 'lost', status: 'not-running' },
      { execId: 'failed', status: 'not-running' },
      { execId: 'e2', status: 'sent' },
    ]);
    expect(writes.map((w) => w.execId)).toEqual(['e1', 'e2']);
  });

  it('marks a target as failed when the write throws, without stopping the others', async () => {
    const { sender, write, writes, log } = setup();
    write.mockImplementationOnce(() => {
      throw new Error('PTY fechado');
    });
    const results = await sender.send(input({ execIds: ['e1', 'e2'] }));
    expect(results).toEqual([
      { execId: 'e1', status: 'failed' },
      { execId: 'e2', status: 'sent' },
    ]);
    expect(writes.map((w) => w.execId)).toEqual(['e2']);
    expect(log.events()).toContain('prompts.send_failed');
  });

  it('blocks everything when a variable has no value, writing nothing', async () => {
    const { sender, writes } = setup();
    await expect(sender.send(input({ body: 'Revise {{arquivo}}', execIds: ['e1', 'e2'] }))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'Preencha a variável {{arquivo}} ou marque para deixar vazia.',
    });
    expect(writes).toEqual([]);
  });

  it('accepts an empty value when the variable is allowed to stay empty', async () => {
    const { sender, writes } = setup();
    await sender.send(input({ body: 'a{{x}}b', allowEmpty: ['x'] }));
    expect(writes[0]?.text).toBe('ab\r');
  });

  it('refuses control characters in the body, in values and in the final text', async () => {
    const { sender, writes } = setup();
    await expect(sender.send(input({ body: 'a\x1b[201~\x1b[200~b' }))).rejects.toMatchObject({
      userMessage: 'O prompt contém caracteres de controle; remova-os.',
    });
    await expect(sender.send(input({ body: '{{x}}', values: { x: 'ok\x1b[201~rm -rf' } }))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    await expect(sender.send(input({ body: '{{x}}', values: { x: 'a\rb' } }))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
    });
    expect(writes).toEqual([]);
  });

  it('refuses an empty final text and a final text over the limit, writing nothing', async () => {
    const { sender, writes } = setup();
    await expect(sender.send(input({ body: '{{x}}', allowEmpty: ['x'] }))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'O texto a enviar está vazio.',
    });
    const big = 'y'.repeat(10_000);
    await expect(
      sender.send(input({ body: 'x'.repeat(95_000) + '{{a}}{{b}}', values: { a: big, b: big } })),
    ).rejects.toMatchObject({ userMessage: 'O prompt deve ter até 100.000 caracteres.' });
    expect(writes).toEqual([]);
  });

  it('keeps a value that looks like a variable literal', async () => {
    const { sender, writes } = setup();
    await sender.send(input({ body: '{{a}} {{b}}', values: { a: '{{b}}', b: 'B' } }));
    expect(writes[0]?.text).toBe('{{b}} B\r');
  });

  it('delivers two concurrent sends to the same session one after the other', async () => {
    const { sender, writes } = setup();
    await Promise.all([sender.send(input({ body: 'primeiro' })), sender.send(input({ body: 'segundo' }))]);
    expect(writes.map((w) => w.text)).toEqual(['primeiro\r', 'segundo\r']);
  });

  it('logs counts only, never the text', async () => {
    const { sender, log } = setup();
    await sender.send(input({ body: 'TEXTO-SECRETO', execIds: ['e1', 'done'] }));
    const rec = log.records.find((r) => r.event === 'prompts.sent');
    expect(rec?.fields).toEqual({ targets: 2, sent: 1 });
    expect(log.text()).not.toContain('SECRETO');
  });
});

describe('PromptSender.preview and resolveFor', () => {
  it('shows the final text for one session without writing', async () => {
    const { sender, writes } = setup();
    expect(sender.preview({ body: '{{pasta}}/{{x}}', values: { x: 'y' }, allowEmpty: [], execId: 'e2' })).toBe(
      '/repos/api/y',
    );
    expect(writes).toEqual([]);
  });

  it('fails for an unknown session', () => {
    const { sender } = setup();
    expect(() => sender.preview({ body: 'x', values: {}, allowEmpty: [], execId: 'nope' })).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID', userMessage: 'Execução não encontrada.' }),
    );
  });
});

describe('PromptSender.deliver', () => {
  it('writes an already resolved text after revalidating it', async () => {
    const { sender, writes } = setup();
    expect(await sender.deliver('e1', 'pronto')).toBe('sent');
    expect(writes).toEqual([{ execId: 'e1', text: 'pronto\r' }]);
    await expect(sender.deliver('e1', 'x\x1b[201~')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('returns the status instead of writing to a session that is not live', async () => {
    const { sender, writes } = setup();
    expect(await sender.deliver('done', 'x')).toBe('not-running');
    expect(await sender.deliver('booting', 'x')).toBe('not-ready');
    expect(await sender.deliver('nope', 'x')).toBe('not-found');
    expect(writes).toEqual([]);
  });
});
