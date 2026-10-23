import { describe, expect, it, vi } from 'vitest';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import type { Execution, ExecutionStatus } from '../../../../src/core/persistence/state-schema';
import { PromptQueue } from '../../../../src/core/prompts/prompt-queue';
import { PromptSender } from '../../../../src/core/prompts/prompt-sender';
import { PromptStore } from '../../../../src/core/prompts/prompt-store';
import type { QueueDiscarded } from '../../../../src/core/prompts/types';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const PATH = '/data/prompts.json';
const decoder = new TextDecoder();

async function setup(statuses: Record<string, ExecutionStatus> = { e1: 'running', e2: 'running' }) {
  const fs = new MemoryFileSystem();
  fs.seed('/data/.keep', '');
  const clock = new FakeClock(Date.parse('2026-10-22T10:00:00.000Z'));
  const log = new MemoryLogger();
  const mutex = new KeyedMutex();
  const store = new PromptStore({ fs, path: PATH, clock, log, mutex });
  await store.load();
  const execs = new Map<string, Execution>(
    Object.entries(statuses).map(([id, status]) => [
      id,
      { id, taskId: 't1', status, worktreePath: `/work/${id}` } as Execution,
    ]),
  );
  const writes: { execId: string; text: string; persistedQueue: number }[] = [];
  const write = vi.fn((execId: string, data: Uint8Array) => {
    // Registra quantos itens a fila gravada em disco ainda tinha no momento da escrita no PTY.
    const onDisk = JSON.parse(fs.readText(PATH)) as { queues: Record<string, unknown[]> };
    writes.push({ execId, text: decoder.decode(data), persistedQueue: onDisk.queues[execId]?.length ?? 0 });
  });
  const model = {
    execution: (id: string) => execs.get(id),
    task: () => ({ id: 't1', groupId: 'g1' }) as never,
    group: () => ({ id: 'g1', name: 'Site', order: 0 }),
  };
  const sender = new PromptSender({ model, executions: { write }, clock, log, mutex });
  const queue = new PromptQueue({ store, sender, model, clock, log, mutex });
  const discarded: QueueDiscarded[] = [];
  queue.onDiscarded((e) => discarded.push(e));
  const set = (id: string, status: ExecutionStatus) => {
    const e = execs.get(id);
    if (e) e.status = status;
  };
  const input = (execId: string, body: string, over: { values?: Record<string, string> } = {}) => ({
    execId,
    body,
    values: over.values ?? {},
    allowEmpty: [],
  });
  return { fs, log, store, queue, writes, write, discarded, set, execs, input, sender };
}

describe('PromptQueue.enqueue', () => {
  it('resolves for the session and appends when the session is busy', async () => {
    const { queue, writes, input } = await setup();
    const items = await queue.enqueue(input('e1', 'pasta={{pasta}} ws={{workspace}} x={{x}}', { values: { x: '1' } }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: 'pasta=/work/e1 ws=Site x=1', enqueuedAt: '2026-10-22T10:00:00.000Z' });
    expect(items[0]?.id).toBeTruthy();
    expect(queue.get('e1')).toEqual(items);
    expect(writes).toEqual([]);
  });

  it('keeps the order of arrival', async () => {
    const { queue, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    expect(queue.get('e1').map((i) => i.text)).toEqual(['um', 'dois']);
  });

  it('persists the queue in the prompts file', async () => {
    const { queue, fs, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    const saved = JSON.parse(fs.readText(PATH)) as { queues: Record<string, { text: string }[]> };
    expect(saved.queues.e1?.map((i) => i.text)).toEqual(['um']);
  });

  it('sends right away to an idle session with an empty queue', async () => {
    const { queue, writes, set, input } = await setup();
    set('e1', 'idle');
    expect(await queue.enqueue(input('e1', 'agora'))).toEqual([]);
    expect(writes).toEqual([{ execId: 'e1', text: 'agora\r', persistedQueue: 0 }]);
    expect(queue.get('e1')).toEqual([]);
  });

  it('appends instead of sending when an idle session already has a queue', async () => {
    const { queue, writes, set, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    set('e1', 'idle');
    await queue.enqueue(input('e1', 'dois'));
    expect(queue.get('e1').map((i) => i.text)).toEqual(['um', 'dois']);
    expect(writes).toEqual([]);
  });

  it('does not send a second time to an idle session before the agent reacts to the first', async () => {
    const { queue, writes, set, input } = await setup();
    set('e1', 'idle');
    await queue.enqueue(input('e1', 'primeiro'));
    await queue.enqueue(input('e1', 'segundo'));
    expect(writes.map((w) => w.text)).toEqual(['primeiro\r']);
    expect(queue.get('e1').map((i) => i.text)).toEqual(['segundo']);
  });

  it('refuses a session that is not live, unknown, or with a missing variable, storing nothing', async () => {
    const { queue, store, set, input } = await setup();
    set('e2', 'exited');
    await expect(queue.enqueue(input('e2', 'x'))).rejects.toMatchObject({ code: 'EXECUTION_NOT_RUNNING' });
    await expect(queue.enqueue(input('zzz', 'x'))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(queue.enqueue(input('e1', '{{falta}}'))).rejects.toMatchObject({
      userMessage: 'Preencha a variável {{falta}} ou marque para deixar vazia.',
    });
    await expect(queue.enqueue(input('e1', 'a\x1b[201~'))).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(store.data().queues).toEqual({});
  });

  it('accepts a session that is still starting', async () => {
    const { queue, input } = await setup({ e1: 'starting' });
    expect(await queue.enqueue(input('e1', 'depois'))).toHaveLength(1);
  });

  it('limits the queue of a session', async () => {
    const { queue, input } = await setup();
    for (let i = 0; i < 50; i++) await queue.enqueue(input('e1', `item ${i}`));
    await expect(queue.enqueue(input('e1', 'a mais'))).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      userMessage: 'A fila desta sessão já tem 50 itens.',
    });
    expect(queue.get('e1')).toHaveLength(50);
  });

  it('logs the action and the size but never the text', async () => {
    const { queue, log, input } = await setup();
    await queue.enqueue(input('e1', 'TEXTO-SECRETO'));
    const rec = log.records.find((r) => r.event === 'prompts.queue');
    expect(rec?.fields).toEqual({ execId: 'e1', action: 'enqueue', size: 1 });
    expect(log.text()).not.toContain('SECRETO');
  });
});

describe('PromptQueue.onIdle', () => {
  it('sends the first item and leaves the next for the next idle', async () => {
    const { queue, writes, set, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    set('e1', 'idle');
    await queue.onIdle('e1');
    expect(writes.map((w) => w.text)).toEqual(['um\r']);
    expect(queue.get('e1').map((i) => i.text)).toEqual(['dois']);
    // O agente fica ocupado com o primeiro e depois ocioso de novo.
    queue.onBusy('e1');
    await queue.onIdle('e1');
    expect(writes.map((w) => w.text)).toEqual(['um\r', 'dois\r']);
    expect(queue.get('e1')).toEqual([]);
  });

  it('removes the item and saves the file before writing to the terminal (at most once)', async () => {
    const { queue, writes, set, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    set('e1', 'idle');
    await queue.onIdle('e1');
    expect(writes).toHaveLength(1);
    expect(writes[0]?.persistedQueue).toBe(0);
  });

  it('sends each item once even when two idle signals arrive together', async () => {
    const { queue, writes, set, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    set('e1', 'idle');
    await Promise.all([queue.onIdle('e1'), queue.onIdle('e1')]);
    expect(writes.map((w) => w.text)).toEqual(['um\r']);
    expect(queue.get('e1').map((i) => i.text)).toEqual(['dois']);
  });

  it('does nothing for an empty queue, a busy session or an unknown one', async () => {
    const { queue, writes, input } = await setup();
    await queue.onIdle('e1');
    await queue.enqueue(input('e1', 'um'));
    await queue.onIdle('e1');
    await queue.onIdle('zzz');
    expect(writes).toEqual([]);
    expect(queue.get('e1')).toHaveLength(1);
  });

  it('keeps the item and sends nothing when the file cannot be saved', async () => {
    const { queue, writes, fs, set, input, log, discarded } = await setup();
    await queue.enqueue(input('e1', 'um'));
    set('e1', 'idle');
    fs.failOn('rename', (p) => p.endsWith('prompts.json.tmp'), 'EACCES');
    await queue.onIdle('e1');
    expect(writes).toEqual([]);
    expect(queue.get('e1')).toHaveLength(1);
    expect(discarded).toEqual([]);
    expect(log.events()).toContain('prompts.queue_dispatch_failed');
  });

  it('discards the item with a notice when the write fails', async () => {
    const { queue, write, set, input, discarded, log } = await setup();
    await queue.enqueue(input('e1', 'um'));
    set('e1', 'idle');
    write.mockImplementationOnce(() => {
      throw new Error('PTY fechado');
    });
    await queue.onIdle('e1');
    expect(queue.get('e1')).toEqual([]);
    expect(discarded).toEqual([{ execId: 'e1', items: 1, reason: 'write-failed' }]);
    expect(log.events()).toContain('prompts.queue_discarded');
  });

  it('discards the item when the session stopped before the write', async () => {
    const { queue, writes, set, input, discarded } = await setup();
    await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    set('e1', 'idle');
    set('e1', 'exited');
    await queue.onIdle('e1');
    expect(writes).toEqual([]);
    expect(queue.get('e1')).toHaveLength(2);
    expect(discarded).toEqual([]);
  });
});

describe('PromptQueue.remove and clear', () => {
  it('removes one item without sending it', async () => {
    const { queue, writes, input } = await setup();
    const [a] = await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    const left = await queue.remove('e1', a!.id);
    expect(left.map((i) => i.text)).toEqual(['dois']);
    expect(writes).toEqual([]);
  });

  it('ignores an unknown item', async () => {
    const { queue, input } = await setup();
    await queue.enqueue(input('e1', 'um'));
    expect((await queue.remove('e1', 'zzz')).map((i) => i.text)).toEqual(['um']);
  });

  it('clears the whole queue without sending and without a discard notice', async () => {
    const { queue, writes, store, input, discarded } = await setup();
    await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    await queue.enqueue(input('e2', 'outro'));
    await queue.clear('e1');
    expect(queue.get('e1')).toEqual([]);
    expect(queue.get('e2')).toHaveLength(1);
    expect(store.data().queues.e1).toBeUndefined();
    expect(writes).toEqual([]);
    expect(discarded).toEqual([]);
  });
});

describe('PromptQueue.onEnded', () => {
  it('discards the queue of a session that ended and tells how many items were lost', async () => {
    const { queue, store, input, discarded, log } = await setup();
    await queue.enqueue(input('e1', 'um'));
    await queue.enqueue(input('e1', 'dois'));
    await queue.enqueue(input('e2', 'fica'));
    await queue.onEnded('e1', 'ended');
    expect(queue.get('e1')).toEqual([]);
    expect(queue.get('e2')).toHaveLength(1);
    expect(store.data().queues.e1).toBeUndefined();
    expect(discarded).toEqual([{ execId: 'e1', items: 2, reason: 'ended' }]);
    expect(log.records.find((r) => r.event === 'prompts.queue_discarded')?.fields).toEqual({
      execId: 'e1',
      items: 2,
    });
  });

  it('reports a removed session and stays quiet when there was nothing queued', async () => {
    const { queue, input, discarded } = await setup();
    await queue.onEnded('e1', 'ended');
    expect(discarded).toEqual([]);
    await queue.enqueue(input('e1', 'um'));
    await queue.onEnded('e1', 'removed');
    expect(discarded).toEqual([{ execId: 'e1', items: 1, reason: 'removed' }]);
  });

  it('stops notifying after unsubscribe', async () => {
    const { queue, input } = await setup();
    const seen: QueueDiscarded[] = [];
    const off = queue.onDiscarded((e) => seen.push(e));
    off();
    await queue.enqueue(input('e1', 'um'));
    await queue.onEnded('e1', 'ended');
    expect(seen).toEqual([]);
  });
});

describe('PromptQueue.resume (app opening)', () => {
  async function withSavedQueues() {
    const first = await setup({ e1: 'running', e2: 'running', e3: 'running' });
    await first.queue.enqueue(first.input('e1', 'a1'));
    await first.queue.enqueue(first.input('e2', 'b1'));
    await first.queue.enqueue(first.input('e3', 'c1'));
    await first.queue.enqueue(first.input('e3', 'c2'));
    await first.queue.enqueue(first.input('e1', 'a2'));
    return first;
  }

  it('discards the queues of sessions that no longer exist or ended, and keeps the others', async () => {
    const first = await withSavedQueues();
    // Reabre o app: a execução e1 sumiu, e2 terminou, e3 continua viva.
    await first.store.update((d) => {
      d.queues.gone = [{ id: 'q', text: 'x', enqueuedAt: '2026-10-22T09:00:00.000Z' }];
    });
    first.execs.delete('e1');
    first.set('e2', 'exited');
    const discarded: QueueDiscarded[] = [];
    first.queue.onDiscarded((e) => discarded.push(e));
    discarded.length = 0;
    await first.queue.resume();
    expect(discarded).toEqual(
      expect.arrayContaining([
        { execId: 'e1', items: 2, reason: 'removed' },
        { execId: 'gone', items: 1, reason: 'removed' },
        { execId: 'e2', items: 1, reason: 'ended' },
      ]),
    );
    expect(discarded).toHaveLength(3);
    expect(first.queue.get('e3').map((i) => i.text)).toEqual(['c1', 'c2']);
  });

  it('sends the first item right away to a session that is already idle', async () => {
    const first = await withSavedQueues();
    first.set('e3', 'idle');
    await first.queue.resume();
    expect(first.writes.filter((w) => w.execId === 'e3').map((w) => w.text)).toEqual(['c1\r']);
    expect(first.queue.get('e3').map((i) => i.text)).toEqual(['c2']);
  });

  it('leaves the queue of a busy session for its next idle', async () => {
    const first = await withSavedQueues();
    await first.queue.resume();
    expect(first.writes).toEqual([]);
    expect(first.queue.get('e3')).toHaveLength(2);
  });
});
