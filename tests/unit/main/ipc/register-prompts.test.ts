import { describe, expect, it } from 'vitest';
import { registerPrompts } from '../../../../src/main/ipc/register-prompts';
import type { Prompt, QueueDiscarded, QueueItem, SendResult } from '../../../../src/shared/ipc-contract';
import { createFakeCore, handleRecorder } from '../../../support/fake-core';
import { createPromptsRig } from '../../../support/prompts-rig';

async function setup() {
  const core = createFakeCore();
  const rig = await createPromptsRig(core);
  const rec = handleRecorder();
  const discarded: QueueDiscarded[] = [];
  registerPrompts(rec.handle, {
    library: rig.library,
    sender: rig.sender,
    queue: rig.queue,
    emitQueueDiscarded: (e) => discarded.push(e),
    model: core.model,
    log: core.log,
  });
  const g = await core.workspace.createGroup('G');
  const g2 = await core.workspace.createGroup('G2');
  const task = await core.workspace.createTask({ groupId: g.id, repoPath: '/repo', baseRef: 'main', prompt: '' });
  const launched = await core.executions.launch(task.id, [{ agentId: 'fake' }, { agentId: 'fake' }], {
    cols: 80,
    rows: 24,
  });
  const [a, b] = launched.map((r) => r.execId);
  if (!a || !b) throw new Error('lançamento falhou');
  return { core, rig, rec, discarded, groupId: g.id, otherGroupId: g2.id, a, b };
}

const body = (over: Record<string, unknown> = {}) => ({
  body: 'Revise {{arquivo}}',
  values: { arquivo: 'a.ts' },
  allowEmpty: [],
  ...over,
});

describe('prompts IPC', () => {
  it('registers the library, send and queue channels', async () => {
    const { rec } = await setup();
    expect(rec.channels()).toEqual([
      'prompts:countForGroup',
      'prompts:duplicate',
      'prompts:list',
      'prompts:preview',
      'prompts:queue:clear',
      'prompts:queue:enqueue',
      'prompts:queue:get',
      'prompts:queue:remove',
      'prompts:remove',
      'prompts:save',
      'prompts:send',
    ]);
  });

  describe('save, list, duplicate, remove', () => {
    it('saves a prompt and lists it with its variables', async () => {
      const { rec } = await setup();
      const saved = await rec.call('prompts:save', { name: 'Revisar', body: 'Revise {{arquivo}}', scope: 'global' });
      expect(saved).toMatchObject({ ok: true, value: { name: 'Revisar', variables: ['arquivo'] } });
      const list = await rec.call('prompts:list');
      expect((list.value as Prompt[]).map((p) => p.name)).toEqual(['Revisar']);
    });

    it('lists the global prompts plus the ones of the workspace asked for', async () => {
      const { rec, groupId, otherGroupId } = await setup();
      await rec.call('prompts:save', { name: 'Global', body: 'x', scope: 'global' });
      await rec.call('prompts:save', { name: 'Meu', body: 'x', scope: { groupId } });
      await rec.call('prompts:save', { name: 'Outro', body: 'x', scope: { groupId: otherGroupId } });
      const names = async (gid?: string) =>
        ((await rec.call('prompts:list', gid)).value as Prompt[]).map((p) => p.name);
      expect(await names(groupId)).toEqual(['Global', 'Meu']);
      expect(await names()).toEqual(['Global']);
    });

    it('refuses a list for an unknown workspace', async () => {
      const { rec } = await setup();
      expect((await rec.call('prompts:list', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
    });

    it('refuses an unknown workspace scope with the contract message', async () => {
      const { rec } = await setup();
      expect(await rec.call('prompts:save', { name: 'A', body: 'x', scope: { groupId: 'nao-existe' } })).toMatchObject({
        ok: false,
        error: { code: 'INPUT_INVALID', message: 'Workspace não encontrado.' },
      });
    });

    it('refuses an invalid name, a long text and control characters with the contract messages', async () => {
      const { rec } = await setup();
      expect((await rec.call('prompts:save', { name: '', body: 'x', scope: 'global' })).error?.message).toBe(
        'O nome do prompt deve ter de 1 a 80 caracteres, sem quebra de linha.',
      );
      expect(
        (await rec.call('prompts:save', { name: 'A', body: 'x'.repeat(100_001), scope: 'global' })).error?.message,
      ).toBe('O prompt deve ter até 100.000 caracteres.');
      expect(
        (await rec.call('prompts:save', { name: 'A', body: 'a\x1bb', scope: 'global' })).error?.message,
      ).toBe('O prompt contém caracteres de controle; remova-os.');
    });

    it('refuses a malformed payload', async () => {
      const { rec } = await setup();
      for (const arg of [undefined, null, 'x', { name: 1, body: 'x', scope: 'global' }, { name: 'A', body: 'x' }]) {
        expect((await rec.call('prompts:save', arg)).error?.code).toBe('INPUT_INVALID');
      }
    });

    it('edits by id, duplicates and removes', async () => {
      const { rec } = await setup();
      const saved = (await rec.call('prompts:save', { name: 'A', body: 'um', scope: 'global' })).value as Prompt;
      const edited = await rec.call('prompts:save', { id: saved.id, name: 'B', body: 'dois', scope: 'global' });
      expect(edited.value).toMatchObject({ id: saved.id, name: 'B' });
      const copy = (await rec.call('prompts:duplicate', saved.id)).value as Prompt;
      expect(copy.name).toBe('B (cópia)');
      expect(await rec.call('prompts:remove', saved.id)).toEqual({ ok: true, value: undefined });
      expect(((await rec.call('prompts:list')).value as Prompt[]).map((p) => p.id)).toEqual([copy.id]);
      expect((await rec.call('prompts:remove', saved.id)).error?.message).toBe('Prompt não encontrado.');
      expect((await rec.call('prompts:duplicate', 'x'.repeat(65))).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('countForGroup', () => {
    it('counts the prompts scoped to a workspace', async () => {
      const { rec, groupId } = await setup();
      await rec.call('prompts:save', { name: 'A', body: 'x', scope: { groupId } });
      await rec.call('prompts:save', { name: 'B', body: 'x', scope: 'global' });
      expect(await rec.call('prompts:countForGroup', groupId)).toEqual({ ok: true, value: 1 });
      expect((await rec.call('prompts:countForGroup', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
    });
  });

  describe('preview', () => {
    it('returns the final text for a session without writing to it', async () => {
      const { rec, core, a } = await setup();
      const r = await rec.call('prompts:preview', { ...body({ body: '{{pasta}} {{arquivo}}' }), execId: a });
      expect(r).toMatchObject({ ok: true });
      expect(r.value).toContain('a.ts');
      expect(core.host.writes.filter((w) => w.execId === a)).toEqual([]);
    });

    it('refuses a missing variable, an unknown session and control characters in values', async () => {
      const { rec, a } = await setup();
      expect((await rec.call('prompts:preview', { ...body({ values: {} }), execId: a })).error?.message).toBe(
        'Preencha a variável {{arquivo}} ou marque para deixar vazia.',
      );
      expect((await rec.call('prompts:preview', { ...body(), execId: 'nao-existe' })).error?.code).toBe(
        'INPUT_INVALID',
      );
      expect(
        (await rec.call('prompts:preview', { ...body({ values: { arquivo: 'a\x1b' } }), execId: a })).error
          ?.message,
      ).toBe('O prompt contém caracteres de controle; remova-os.');
    });
  });

  describe('send', () => {
    it('writes the resolved text to each target and reports a status per session', async () => {
      const { rec, core, a, b } = await setup();
      const r = await rec.call('prompts:send', { ...body(), execIds: [a, b] });
      expect(r.value as SendResult[]).toEqual([
        { execId: a, status: 'sent' },
        { execId: b, status: 'sent' },
      ]);
      const sent = core.host.writes.filter((w) => w.execId === a || w.execId === b);
      expect(sent.map((w) => w.data)).toEqual(['Revise a.ts\r', 'Revise a.ts\r']);
    });

    it('reports an ended session and a removed one without stopping the rest', async () => {
      const { rec, core, a, b } = await setup();
      core.model.mutate((s) => {
        const e = s.executions.find((x) => x.id === b);
        if (e) e.status = 'exited';
      });
      const r = await rec.call('prompts:send', { ...body(), execIds: [a, b, 'ffffffff-removida'] });
      expect((r.value as SendResult[]).map((x) => x.status)).toEqual(['sent', 'not-running', 'not-found']);
    });

    it('validates the destinations: 1 to 12 distinct ids', async () => {
      const { rec, a } = await setup();
      for (const execIds of [[], [a, a], Array.from({ length: 13 }, (_, i) => `e${i}`), 'x', [1]]) {
        expect((await rec.call('prompts:send', { ...body(), execIds })).error?.code).toBe('INPUT_INVALID');
      }
    });

    it('refuses control characters in the text and in the values before writing anything', async () => {
      const { rec, core, a } = await setup();
      expect((await rec.call('prompts:send', { ...body({ body: 'x\x1b[201~' }), execIds: [a] })).error?.message).toBe(
        'O prompt contém caracteres de controle; remova-os.',
      );
      expect(
        (await rec.call('prompts:send', { ...body({ values: { arquivo: '\x07' } }), execIds: [a] })).error?.code,
      ).toBe('INPUT_INVALID');
      expect(core.host.writes.filter((w) => w.execId === a)).toEqual([]);
    });

    it('refuses invalid variable names and oversized values', async () => {
      const { rec, a } = await setup();
      expect(
        (await rec.call('prompts:send', { ...body({ values: { 'a-b': 'x' } }), execIds: [a] })).error?.code,
      ).toBe('INPUT_INVALID');
      expect(
        (await rec.call('prompts:send', { ...body({ values: { arquivo: 'x'.repeat(10_001) } }), execIds: [a] }))
          .error?.code,
      ).toBe('INPUT_INVALID');
    });

    it('lets an empty value through when the variable is allowed to be empty', async () => {
      const { rec, core, a } = await setup();
      await rec.call('prompts:send', { ...body({ values: {}, allowEmpty: ['arquivo'] }), execIds: [a] });
      expect(core.host.writes.at(-1)?.data).toBe('Revise \r');
    });

    it('never logs the prompt text', async () => {
      const { rec, core, a } = await setup();
      await rec.call('prompts:send', { ...body({ body: 'TEXTO-SECRETO' }), execIds: [a] });
      await rec.call('prompts:save', { name: 'NOME-SECRETO', body: 'CORPO-SECRETO', scope: 'global' });
      expect(core.log.text()).not.toContain('SECRETO');
    });
  });

  describe('queue', () => {
    const enqueue = (execId: string, over: Record<string, unknown> = {}) => ({
      ...body({ body: 'Rode {{pasta}} {{teste}}', values: { teste: 'unit' } }),
      execId,
      ...over,
    });
    const setStatus = (core: Awaited<ReturnType<typeof setup>>['core'], id: string, status: 'idle' | 'exited') =>
      core.model.mutate((s) => {
        const e = s.executions.find((x) => x.id === id);
        if (e) e.status = status;
      });

    it('starts empty and lists what was queued, resolved for the session', async () => {
      const { rec, a } = await setup();
      expect(await rec.call('prompts:queue:get', a)).toEqual({ ok: true, value: [] });
      const r = await rec.call('prompts:queue:enqueue', enqueue(a));
      const items = r.value as QueueItem[];
      expect(items).toHaveLength(1);
      expect(items[0]?.text).toMatch(/^Rode .+ unit$/);
      expect(items[0]?.text).not.toContain('{{');
      expect((await rec.call('prompts:queue:get', a)).value).toEqual(items);
    });

    it('sends right away to an idle session with an empty queue', async () => {
      const { rec, core, a } = await setup();
      setStatus(core, a, 'idle');
      const r = await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'agora', values: {} }));
      expect(r).toEqual({ ok: true, value: [] });
      expect(core.host.writes.filter((w) => w.execId === a).map((w) => w.data)).toContain('agora\r');
    });

    it('refuses a session that is not running, an unknown one and a missing variable', async () => {
      const { rec, core, a, b } = await setup();
      setStatus(core, b, 'exited');
      expect((await rec.call('prompts:queue:enqueue', enqueue(b))).error?.code).toBe('EXECUTION_NOT_RUNNING');
      expect((await rec.call('prompts:queue:enqueue', enqueue('nao-existe'))).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('prompts:queue:enqueue', enqueue(a, { values: {} }))).error?.message).toBe(
        'Preencha a variável {{teste}} ou marque para deixar vazia.',
      );
      expect(
        (await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'x\x1b[201~', values: {} }))).error?.message,
      ).toBe('O prompt contém caracteres de controle; remova-os.');
      expect((await rec.call('prompts:queue:get', a)).value).toEqual([]);
    });

    it('removes one item and clears the rest without sending anything', async () => {
      const { rec, core, a } = await setup();
      await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'um', values: {} }));
      const two = await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'dois', values: {} }));
      const [first] = two.value as QueueItem[];
      const left = await rec.call('prompts:queue:remove', a, first?.id);
      expect((left.value as QueueItem[]).map((i) => i.text)).toEqual(['dois']);
      expect(await rec.call('prompts:queue:clear', a)).toEqual({ ok: true, value: undefined });
      expect((await rec.call('prompts:queue:get', a)).value).toEqual([]);
      expect(core.host.writes.filter((w) => w.execId === a)).toEqual([]);
    });

    it('validates the arguments', async () => {
      const { rec, a } = await setup();
      expect((await rec.call('prompts:queue:get', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('prompts:queue:get')).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('prompts:queue:remove', a)).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('prompts:queue:remove', a, 42)).error?.code).toBe('INPUT_INVALID');
      expect((await rec.call('prompts:queue:clear', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
    });

    it('sends the first item when the session goes idle', async () => {
      const { rec, core, a } = await setup();
      core.host.output(a, 'trabalhando');
      await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'um', values: {} }));
      await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'dois', values: {} }));
      core.clock.advance(10 ** 12);
      await new Promise((r) => setTimeout(r, 20));
      expect(core.host.writes.filter((w) => w.execId === a).map((w) => w.data)).toEqual(['um\r']);
      expect(((await rec.call('prompts:queue:get', a)).value as QueueItem[]).map((i) => i.text)).toEqual(['dois']);
    });

    it('emits the discard notice when the session ends with items queued', async () => {
      const { rec, core, discarded, a } = await setup();
      await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'um', values: {} }));
      await rec.call('prompts:queue:enqueue', enqueue(a, { body: 'dois', values: {} }));
      core.host.exit(a, 0);
      await new Promise((r) => setTimeout(r, 20));
      expect(discarded).toEqual([{ execId: a, items: 2, reason: 'ended' }]);
      expect((await rec.call('prompts:queue:get', a)).value).toEqual([]);
    });
  });
});
