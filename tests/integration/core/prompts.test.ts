import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Execution } from '../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../support/execution-harness';
import { collector, sleep, type Collector } from '../../support/host-harness';
import { removeDirRecursive } from '../../support/temp-dirs';

let h: CoreHarness;
const folders: string[] = [];

beforeEach(async () => {
  h = await createCoreHarness();
});

afterEach(async () => {
  await h.cleanup();
  for (const f of folders.splice(0)) removeDirRecursive(f);
});

const SIZE = { cols: 100, rows: 30 };

function folder(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'melinna-prompts-')));
  folders.push(dir);
  return dir;
}

function exec(id: string): Execution {
  const e = h.model.execution(id);
  if (!e) throw new Error(`sem execução ${id}`);
  return e;
}

async function waitStatus(id: string, statuses: string[], timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!statuses.includes(exec(id).status)) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`status ${exec(id).status}, esperado ${statuses.join('|')}`);
    await sleep(25);
  }
}

interface Session {
  exec: Execution;
  out: Collector;
}

/** Abre um workspace na pasta, lança o agente falso direto nela e espera o terminal ficar pronto. */
async function openSession(dir: string, groupId?: string): Promise<Session & { groupId: string }> {
  const ws = groupId ? { id: groupId } : await h.workspace.openWorkspace(dir);
  const task = await h.workspace.createTask({
    groupId: ws.id,
    repoPath: dir,
    baseRef: 'HEAD',
    prompt: '',
    isolation: 'direct',
  });
  const [r] = await h.executions.launch(task.id, [{ agentId: 'fake' }], SIZE);
  expect(r?.ok).toBe(true);
  const e = h.model.executionsOf(task.id)[0]!;
  await waitStatus(e.id, ['running', 'idle']);
  const out = collector();
  await h.executions.attach(e.id, out.sink);
  await out.waitFor('pronto');
  return { exec: e, out, groupId: ws.id };
}

describe('prompts: envio a uma sessão', () => {
  it('delivers the resolved prompt to the agent as typed and confirmed input', async () => {
    const dir = folder();
    const { exec: e, out } = await openSession(dir);
    const results = await h.prompts.sender.send({
      body: 'Olá {{nome}}, revise {{pasta}}',
      values: { nome: 'Ana' },
      allowEmpty: [],
      execIds: [e.id],
    });
    expect(results).toEqual([{ execId: e.id, status: 'sent' }]);
    await out.waitFor(`echo:Olá Ana, revise ${dir}`);
  });

  it('fills the workspace name and keeps a value that looks like a variable literal', async () => {
    const dir = folder();
    const { exec: e, out } = await openSession(dir);
    const ws = h.model.group(h.model.task(e.taskId)!.groupId)!;
    await h.prompts.sender.send({
      body: '{{workspace}}|{{a}}|{{b}}',
      values: { a: '{{b}}', b: 'B' },
      allowEmpty: [],
      execIds: [e.id],
    });
    await out.waitFor(`echo:${ws.name}|{{b}}|B`);
  });

  it('reports not-running for a stopped session and writes nothing', async () => {
    const dir = folder();
    const { exec: e } = await openSession(dir);
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    expect(await h.prompts.sender.send({ body: 'oi', values: {}, allowEmpty: [], execIds: [e.id] })).toEqual([
      { execId: e.id, status: 'not-running' },
    ]);
  });
});

describe('prompts: envio a várias sessões', () => {
  it('gives each session its own folder and leaves the unmarked one alone', async () => {
    const [dirA, dirB, dirC] = [folder(), folder(), folder()] as [string, string, string];
    const a = await openSession(dirA);
    const b = await openSession(dirB);
    const c = await openSession(dirC);
    const results = await h.prompts.sender.send({
      body: 'pasta={{pasta}}',
      values: {},
      allowEmpty: [],
      execIds: [a.exec.id, b.exec.id],
    });
    expect(results).toEqual([
      { execId: a.exec.id, status: 'sent' },
      { execId: b.exec.id, status: 'sent' },
    ]);
    await a.out.waitFor(`echo:pasta=${dirA}`);
    await b.out.waitFor(`echo:pasta=${dirB}`);
    await sleep(300);
    expect(a.out.text()).not.toContain(dirB);
    expect(b.out.text()).not.toContain(dirA);
    expect(c.out.text()).not.toContain('echo:pasta=');
  });

  it('reports not-running for a session that ended while the others receive the text', async () => {
    const [dirA, dirB] = [folder(), folder()] as [string, string];
    const a = await openSession(dirA);
    const b = await openSession(dirB);
    await h.executions.stop(b.exec.id);
    await waitStatus(b.exec.id, ['exited']);
    const results = await h.prompts.sender.send({
      body: 'oi {{workspace}}',
      values: {},
      allowEmpty: [],
      execIds: [a.exec.id, b.exec.id],
    });
    expect(results).toEqual([
      { execId: a.exec.id, status: 'sent' },
      { execId: b.exec.id, status: 'not-running' },
    ]);
    await a.out.waitFor('echo:oi ');
  });
});

describe('prompts: fila por sessão', () => {
  it('dispatches one item per idle period, in order, while the agent is busy in between', async () => {
    const { exec: e, out } = await openSession(folder());
    await waitStatus(e.id, ['idle'], 15_000);
    await h.prompts.sender.send({ body: '/busy 600', values: {}, allowEmpty: [], execIds: [e.id] });
    await waitStatus(e.id, ['running']);
    const request = (body: string) => ({ execId: e.id, body, values: {}, allowEmpty: [] });
    await h.prompts.queue.enqueue(request('primeiro'));
    await h.prompts.queue.enqueue(request('segundo'));
    expect(h.prompts.queue.get(e.id).map((i) => i.text)).toEqual(['primeiro', 'segundo']);
    expect(out.text()).not.toContain('echo:primeiro');

    await out.waitFor('echo:primeiro', 15_000);
    expect(h.prompts.queue.get(e.id).map((i) => i.text)).toEqual(['segundo']);
    expect(out.text()).not.toContain('echo:segundo');

    await out.waitFor('echo:segundo', 15_000);
    expect(h.prompts.queue.get(e.id)).toEqual([]);
    expect(out.text().indexOf('echo:primeiro')).toBeLessThan(out.text().indexOf('echo:segundo'));
  });

  it('sends right away to an idle session and keeps nothing queued', async () => {
    const { exec: e, out } = await openSession(folder());
    await waitStatus(e.id, ['idle'], 15_000);
    expect(await h.prompts.queue.enqueue({ execId: e.id, body: 'já', values: {}, allowEmpty: [] })).toEqual([]);
    await out.waitFor('echo:já');
  });

  it('discards the queue, with a notice, when the session ends', async () => {
    const { exec: e } = await openSession(folder());
    await waitStatus(e.id, ['idle'], 15_000);
    await h.prompts.sender.send({ body: '/busy 3000', values: {}, allowEmpty: [], execIds: [e.id] });
    await waitStatus(e.id, ['running']);
    const discarded: unknown[] = [];
    h.prompts.queue.onDiscarded((d) => discarded.push(d));
    await h.prompts.queue.enqueue({ execId: e.id, body: 'nunca', values: {}, allowEmpty: [] });
    await h.executions.stop(e.id);
    await waitStatus(e.id, ['exited']);
    await sleep(200);
    expect(discarded).toEqual([{ execId: e.id, items: 1, reason: 'ended' }]);
    expect(h.prompts.queue.get(e.id)).toEqual([]);
  });
});
