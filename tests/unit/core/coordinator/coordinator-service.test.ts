import { runInNewContext } from 'node:vm';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COORDINATOR_MAX_WORKERS,
  COORDINATOR_POLL_MS,
  CoordinatorService,
  coordinatorInstructions,
  parseWorkerRequest,
  REQUEST_MAX_BYTES,
  type WorkerResult,
} from '../../../../src/core/coordinator/coordinator-service';
import type { MelinnaError } from '../../../../src/core/errors';
import type { Task } from '../../../../src/core/persistence/state-schema';
import { SessionLauncher } from '../../../../src/core/workspace/session-launcher';
import { createFakeCore } from '../../../support/fake-core';

async function setup() {
  const core = createFakeCore();
  const sessions = new SessionLauncher({ workspace: core.workspace, executions: core.executions });
  const service = new CoordinatorService({
    fs: core.fs,
    os: 'linux',
    clock: core.clock,
    log: core.log,
    model: core.model,
    launch: (input) => sessions.launch(input),
  });
  const group = await core.workspace.openWorkspace('/repo');
  const task = await core.workspace.createTask({
    groupId: group.id,
    repoPath: '/repo',
    baseRef: 'HEAD',
    prompt: 'Refatore o módulo de pagamentos.',
    title: 'Pagamentos',
    isolation: 'direct',
  });
  const dir = `/repo/.melinna/spawn/${task.id}`;
  const request = (name: string, body: unknown) =>
    core.fs.seed(`${dir}/${name}`, typeof body === 'string' ? body : JSON.stringify(body));
  const result = async (name: string) =>
    JSON.parse(new TextDecoder().decode(await core.fs.readFile(`${dir}/${name}`))) as WorkerResult;
  /** Lança o coordenador: sem execução viva, os pedidos não disparam. */
  const launchCoordinator = async () => {
    const prompt = await service.enable(task);
    const [r] = await core.executions.launch(
      task.id,
      [{ agentId: 'fake' }],
      { cols: 80, rows: 24 },
      { prompt },
    );
    if (!r?.ok) throw new Error('coordenador não lançou');
    return { prompt, execId: r.execId };
  };
  return { core, service, task, dir, request, result, launchCoordinator };
}

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as MelinnaError).userMessage;
  }
  throw new Error('deveria ter falhado');
}

describe('parseWorkerRequest', () => {
  it('reads agent, prompt, title and isolation, defaulting to a worktree', () => {
    expect(parseWorkerRequest('{"agent":"codex","prompt":"Escreva os testes."}')).toEqual({
      agent: 'codex',
      prompt: 'Escreva os testes.',
      isolation: 'worktree',
    });
    expect(
      parseWorkerRequest('{"agent":"claude","prompt":"a\\r\\nb","title":" Testes ","isolation":"direct"}'),
    ).toEqual({ agent: 'claude', prompt: 'a\nb', title: 'Testes', isolation: 'direct' });
  });

  it('refuses malformed requests with a reason the agent can act on', () => {
    expect(message(() => parseWorkerRequest('{ não é json'))).toBe('O pedido não é um JSON válido.');
    expect(message(() => parseWorkerRequest('[]'))).toBe('O pedido deve ser um objeto JSON.');
    expect(message(() => parseWorkerRequest('{"agent":"Claude Code","prompt":"x"}'))).toMatch(/"agent"/);
    expect(message(() => parseWorkerRequest('{"agent":"claude","prompt":"  "}'))).toMatch(/"prompt"/);
    expect(message(() => parseWorkerRequest('{"agent":"claude","prompt":"x\\u001b[2J"}'))).toMatch(
      /controle/,
    );
    expect(message(() => parseWorkerRequest('{"agent":"claude","prompt":"x","title":""}'))).toMatch(
      /"title"/,
    );
    expect(message(() => parseWorkerRequest('{"agent":"claude","prompt":"x","isolation":"vm"}'))).toMatch(
      /"isolation"/,
    );
  });
});

describe('coordinatorInstructions', () => {
  it('tells the agent where and how to ask for workers, and the limit', () => {
    const text = coordinatorInstructions('/repo/.melinna/spawn/t1');
    expect(text).toContain('/repo/.melinna/spawn/t1');
    expect(text).toContain('"agent"');
    expect(text).toContain('.result.json');
    expect(text).toContain(`${COORDINATOR_MAX_WORKERS} workers`);
  });
});

describe('CoordinatorService', () => {
  it('enable creates the request folder and puts the instructions before the user prompt', async () => {
    const { core, service, task, dir } = await setup();
    const prompt = await service.enable(task);
    expect(await core.fs.exists(dir)).toBe(true);
    expect(prompt.startsWith(coordinatorInstructions(dir))).toBe(true);
    expect(prompt.endsWith('Objetivo do usuário:\nRefatore o módulo de pagamentos.')).toBe(true);
    expect(service.isCoordinator(task.id)).toBe(true);
  });

  it('sends only the instructions when the user wrote no prompt', async () => {
    const { service, task, dir } = await setup();
    expect(await service.enable({ ...task, prompt: '' } as Task)).toBe(coordinatorInstructions(dir));
  });

  it('hides .melinna from git status through .git/info/exclude, once', async () => {
    const { core, service, task } = await setup();
    core.fs.seed('/repo/.git/info/exclude', '# local\n*.log');
    await service.enable(task);
    await service.enable(task);
    expect(new TextDecoder().decode(await core.fs.readFile('/repo/.git/info/exclude'))).toBe(
      '# local\n*.log\n.melinna/\n',
    );
  });

  it('launches a requested worker in its own worktree of the same folder and writes the result', async () => {
    const { core, service, request, result, launchCoordinator } = await setup();
    await launchCoordinator();
    request('testes.json', { agent: 'fake', prompt: 'Escreva os testes.', title: 'Testes' });
    await service.poll();
    const r = await result('testes.result.json');
    expect(r).toMatchObject({ status: 'launched', worker: expect.any(String) });
    if (r.status !== 'launched') throw new Error('esperava lançado');
    const worker = core.model.execution(r.execId);
    expect(core.model.task(r.taskId)).toMatchObject({ title: 'Testes', repoPath: '/repo' });
    expect(r.folder).toBe(worker?.worktreePath);
    expect(r.folder).not.toBe('/repo');
    expect(r.branch).not.toBe('');
    expect(core.host.spawns.at(-1)?.args.at(-1)).toBe('Escreva os testes.');
  });

  it('handles each request once', async () => {
    const { core, service, request, launchCoordinator } = await setup();
    await launchCoordinator();
    request('a.json', { agent: 'fake', prompt: 'A' });
    await service.poll();
    await service.poll();
    expect(core.workspace.snapshot().tasks).toHaveLength(2);
  });

  it('writes the reason when a request is refused and launches nothing', async () => {
    const { core, service, request, result, launchCoordinator } = await setup();
    await launchCoordinator();
    request('ruim.json', '{ não é json');
    request('agente.json', { agent: 'nao-existe', prompt: 'x' });
    request('grande.json', 'x'.repeat(REQUEST_MAX_BYTES + 1));
    await service.poll();
    expect(await result('ruim.result.json')).toMatchObject({
      status: 'refused',
      reason: 'O pedido não é um JSON válido.',
    });
    expect(await result('agente.result.json')).toMatchObject({ status: 'refused' });
    expect(await result('grande.result.json')).toMatchObject({ reason: 'O pedido é grande demais.' });
    expect(core.workspace.snapshot().executions.filter((e) => e.status !== 'failed_to_start')).toHaveLength(
      1,
    );
  });

  it('ignores files that are not requests: other names, result files and links', async () => {
    const { core, service, request, dir, launchCoordinator } = await setup();
    await launchCoordinator();
    request('notas.txt', 'x');
    request('.oculto.json', { agent: 'fake', prompt: 'x' });
    request('solto.result.json', { status: 'refused' });
    core.fs.seedLink(`${dir}/link.json`, '/etc/passwd');
    await service.poll();
    expect(core.workspace.snapshot().tasks).toHaveLength(1);
    expect(await core.fs.exists(`${dir}/notas.result.json`)).toBe(false);
    const link = JSON.parse(
      new TextDecoder().decode(await core.fs.readFile(`${dir}/link.result.json`)),
    ) as WorkerResult;
    expect(link).toMatchObject({ status: 'refused', reason: 'O pedido deve ser um arquivo comum.' });
  });

  it('does not launch anything while the coordinator has no live execution', async () => {
    const { core, service, task, request, dir } = await setup();
    await service.enable(task);
    request('a.json', { agent: 'fake', prompt: 'A' });
    await service.poll();
    expect(core.workspace.snapshot().tasks).toHaveLength(1);
    expect(await core.fs.exists(`${dir}/a.result.json`)).toBe(false);
  });

  it('refuses requests above the worker limit', async () => {
    const { service, request, result, launchCoordinator } = await setup();
    await launchCoordinator();
    for (let i = 0; i < COORDINATOR_MAX_WORKERS + 1; i++) {
      request(`w${String(i).padStart(2, '0')}.json`, {
        agent: 'fake',
        prompt: `Parte ${i}`,
        isolation: 'direct',
      });
    }
    await service.poll();
    expect((await result('w07.result.json')).status).toBe('launched');
    expect(await result(`w0${COORDINATOR_MAX_WORKERS}.result.json`)).toMatchObject({
      status: 'refused',
      reason: `Este coordenador já abriu o limite de ${COORDINATOR_MAX_WORKERS} workers.`,
    });
  });

  it('rewrites the result when the state of the worker changes', async () => {
    const { core, service, request, result, launchCoordinator } = await setup();
    await launchCoordinator();
    request('a.json', { agent: 'fake', prompt: 'A' });
    await service.poll();
    const first = await result('a.result.json');
    if (first.status !== 'launched') throw new Error('esperava lançado');
    core.model.mutate((s) => {
      const exec = s.executions.find((e) => e.id === first.execId);
      if (exec) exec.status = 'exited';
    });
    await service.poll();
    expect(await result('a.result.json')).toMatchObject({ status: 'launched', worker: 'exited' });
  });

  it('polls on a timer after start and resumes coordinators that already had a request folder', async () => {
    const first = await setup();
    await first.launchCoordinator();
    const { core, task, dir, request } = first;
    const sessions = new SessionLauncher({ workspace: core.workspace, executions: core.executions });
    const reopened = new CoordinatorService({
      fs: core.fs,
      os: 'linux',
      clock: core.clock,
      log: core.log,
      model: core.model,
      launch: (input) => sessions.launch(input),
    });
    await reopened.start();
    expect(reopened.isCoordinator(task.id)).toBe(true);
    request('a.json', { agent: 'fake', prompt: 'A' });
    core.clock.advance(COORDINATOR_POLL_MS);
    for (let i = 0; i < 50; i++) await Promise.resolve();
    expect(await core.fs.exists(`${dir}/a.result.json`)).toBe(true);
    reopened.stop();
    expect(core.clock.pending()).toBe(0);
  });

  it('forgets a coordinator whose task was removed', async () => {
    const { core, service, task, launchCoordinator } = await setup();
    await launchCoordinator();
    core.model.mutate((s) => {
      s.tasks = s.tasks.filter((t) => t.id !== task.id);
    });
    await service.poll();
    expect(service.isCoordinator(task.id)).toBe(false);
  });

  it('never logs the prompt of a worker', async () => {
    const { core, service, request, launchCoordinator } = await setup();
    await launchCoordinator();
    request('a.json', { agent: 'fake', prompt: 'Segredo do worker.' });
    await service.poll();
    expect(core.log.text()).not.toContain('Segredo do worker');
  });
});

it('installs the app worker command beside the coordinator requests', async () => {
  const { core, service, task, dir } = await setup();
  const prompt = await service.enable(task);
  const command = new TextDecoder().decode(await core.fs.readFile(`${dir}/spawn-worker.cjs`));
  const files = new Map<string, string>();
  let output = '';
  const request = { agent: 'fake', prompt: 'Work', isolation: 'direct' };
  runInNewContext(command, {
    Buffer,
    __dirname: dir,
    require: (name: string) => {
      if (name === 'node:path') return path.posix;
      if (name === 'node:crypto') return { randomUUID: () => 'request-1' };
      if (name === 'node:fs')
        return {
          readFileSync: () => JSON.stringify(request),
          writeFileSync: (name: string, body: string) => files.set(name, body),
          renameSync: (from: string, to: string) => {
            files.set(to, files.get(from)!);
            files.delete(from);
          },
        };
      throw new Error(name);
    },
    process: {
      stdout: {
        write: (value: string) => {
          output += value;
        },
      },
      stderr: {
        write: (value: string) => {
          throw new Error(value);
        },
      },
    },
  });
  expect(JSON.parse(files.get(`${dir}/request-1.json`)!)).toEqual(request);
  expect(files.has(`${dir}/request-1.pending`)).toBe(false);
  expect(output.trim()).toBe(`${dir}/request-1.result.json`);
  expect(prompt).toContain(`node "${dir}/spawn-worker.cjs" < pedido.json`);
});
