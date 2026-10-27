import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrchestrationService } from '../../../../src/core/orchestration/orchestration-service';
import { DEFAULT_TEAM, type OrchestrationSnapshot } from '../../../../src/core/orchestration/types';
import type {
  OrchestrationStore,
  OrchestrationRuntime,
  TurnRequest,
  TurnOutput,
} from '../../../../src/core/orchestration/ports';

const services: OrchestrationService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.shutdown()));
});
function setup(initial?: OrchestrationSnapshot) {
  let state = structuredClone(
    initial ?? { schemaVersion: 1, templates: [], runs: [] },
  ) as OrchestrationSnapshot;
  const store: OrchestrationStore = {
    load: async () => structuredClone(state),
    save: vi.fn(async (value) => {
      state = structuredClone(value);
    }),
  };
  const runtime = {
    preflight: vi.fn(async () => ({ version: 'fake-1' })),
    baseline: vi.fn(async () => 'a'.repeat(40)),
    prepare: vi.fn(async (_run: string, job: string) => ({ cwd: '/isolated/' + job })),
    patch: vi.fn(async () => ''),
    apply: vi.fn(async () => 'fingerprint'),
    turn: vi.fn<(request: TurnRequest) => Promise<TurnOutput>>(async () => ({
      text: 'done',
      sessionId: 'session-1',
    })),
  } satisfies OrchestrationRuntime;
  let next = 0;
  const bridge = {
    open: vi.fn(async () => ({ url: 'http://fake/mcp', token: 'test-only' })),
    revoke: vi.fn(),
    close: vi.fn(async () => undefined),
  };
  const service = new OrchestrationService({
    store,
    runtime,
    bridge,
    newId: () => 'id-' + ++next,
    workspace: (group) => (group === 'workspace' ? '/repo' : undefined),
    now: () => new Date().toISOString(),
    changed: vi.fn(),
  });
  services.push(service);
  return { service, runtime, store, bridge, stored: () => state };
}
async function launch(f: ReturnType<typeof setup>, limits: Partial<typeof DEFAULT_TEAM.limits> = {}) {
  await f.service.load();
  const team = await f.service.saveTeam({
    ...structuredClone(DEFAULT_TEAM),
    limits: { ...DEFAULT_TEAM.limits, ...limits },
  });
  return f.service.start({
    teamId: team.id,
    groupId: 'workspace',
    prompt: 'Analyze the fixture. Do not run tests.',
  });
}
const runOf = (f: ReturnType<typeof setup>) => f.service.snapshot().runs[0];

describe('OrchestrationService', () => {
  it('starts one coordinator, persists its response and resumes by explicit session identity', async () => {
    const f = setup();
    const id = await launch(f);
    await vi.waitFor(() => expect(runOf(f)?.status).toBe('succeeded'));
    expect(f.stored().runs[0]?.messages.at(-1)?.text).toBe('done');
    await vi.waitFor(() => expect(f.service.liveCount()).toBe(0));
    await f.service.message(id, 'Explain the result');
    await vi.waitFor(() => expect(f.runtime.turn).toHaveBeenCalledTimes(2));
    expect(f.runtime.turn.mock.calls[1]?.[0].sessionId).toBe('session-1');
    expect(f.bridge.revoke).toHaveBeenCalledWith(id);
  });
  it('delegates distinct work to two providers and returns both results to the coordinator', async () => {
    const f = setup();
    let turn = 0;
    f.runtime.turn.mockImplementation(async (request) => {
      if (!request.bridge) return { text: 'result-' + request.role.provider };
      if (++turn === 1) {
        const run = runOf(f);
        if (!run) throw new Error('missing run');
        await Promise.all(
          run.team.workers.map((role) =>
            f.service.tool(run.id, 'delegate_task', {
              roleId: role.id,
              prompt: 'task for ' + role.name,
              requestKey: role.id,
            }),
          ),
        );
        return { text: 'delegated', sessionId: 'coordinator' };
      }
      expect(request.prompt).toContain('result-claude');
      expect(request.prompt).toContain('result-codex');
      return { text: 'synthesis' };
    });
    await launch(f);
    await vi.waitFor(() => expect(runOf(f)?.status).toBe('succeeded'));
    expect(runOf(f)?.jobs.map((j) => j.status)).toEqual(['succeeded', 'succeeded']);
    expect(f.runtime.prepare.mock.calls.map((c) => c[1])).toHaveLength(2);
    expect(runOf(f)?.messages.at(-1)?.text).toBe('synthesis');
  });
  it('does not pay for another coordinator turn when MCP already delivered the finished result', async () => {
    const f = setup();
    let coordinatorTurns = 0;
    f.runtime.turn.mockImplementation(async (request) => {
      if (!request.bridge) return { text: 'worker result' };
      coordinatorTurns++;
      const run = runOf(f);
      if (!run) throw new Error('missing run');
      await f.service.tool(run.id, 'delegate_task', {
        roleId: 'researcher',
        prompt: 'inspect',
        requestKey: 'one',
      });
      await f.service.tool(run.id, 'wait_tasks', {});
      return { text: 'Already consumed the worker result.' };
    });
    await launch(f);
    await vi.waitFor(() => expect(runOf(f)?.status).toBe('succeeded'));
    expect(coordinatorTurns).toBe(1);
  });
  it('reserves parallel slots, pauses queued dispatch and restores it without duplicating jobs', async () => {
    const f = setup();
    const finish: (() => void)[] = [];
    let coordinator = 0;
    f.runtime.turn.mockImplementation(async (request) => {
      if (request.bridge) {
        if (++coordinator === 1) {
          const run = runOf(f);
          if (!run) throw new Error('run');
          for (const key of ['first', 'second'])
            await f.service.tool(run.id, 'delegate_task', {
              roleId: 'researcher',
              prompt: key,
              requestKey: key,
            });
        }
        return { text: 'coordinator' };
      }
      await new Promise<void>((resolve, reject) => {
        finish.push(resolve);
        request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { text: 'worker' };
    });
    const id = await launch(f, { parallel: 1 });
    await vi.waitFor(() => expect(finish).toHaveLength(1));
    await f.service.control(id, 'pause');
    finish[0]?.();
    await vi.waitFor(() => expect(runOf(f)?.jobs[0]?.status).toBe('succeeded'));
    expect(runOf(f)?.jobs[1]?.status).toBe('queued');
    expect(finish).toHaveLength(1);
    await f.service.control(id, 'resume');
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[1]?.();
    await vi.waitFor(() => expect(runOf(f)?.status).toBe('succeeded'));
    expect(runOf(f)?.jobs).toHaveLength(2);
  });
  it('deduplicates a request and rejects key reuse, unknown roles and jobs over the cap', async () => {
    const f = setup();
    f.runtime.turn.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }),
        ),
    );
    const id = await launch(f, { jobs: 1 });
    const input = { roleId: 'researcher', prompt: 'inspect', requestKey: 'stable' };
    const first = await f.service.tool(id, 'delegate_task', input);
    const repeated = await f.service.tool(id, 'delegate_task', input);
    expect((first as { jobId: string }).jobId).toBe((repeated as { jobId: string }).jobId);
    expect(runOf(f)?.jobs).toHaveLength(1);
    await expect(f.service.tool(id, 'delegate_task', { ...input, prompt: 'different' })).rejects.toThrow(
      /idempotência/,
    );
    await expect(
      f.service.tool(id, 'delegate_task', { ...input, roleId: 'root', requestKey: 'other' }),
    ).rejects.toThrow(/não autorizado/);
    await expect(f.service.tool(id, 'delegate_task', { ...input, requestKey: 'other' })).rejects.toThrow(
      /Limite total/,
    );
  });
  it('cancels the entire tree and refuses further authenticated delegation', async () => {
    const f = setup();
    f.runtime.turn.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }),
        ),
    );
    const id = await launch(f);
    await f.service.tool(id, 'delegate_task', { roleId: 'researcher', prompt: 'inspect', requestKey: 'one' });
    await f.service.control(id, 'cancel');
    await vi.waitFor(() => expect(f.service.liveCount()).toBe(0));
    expect(runOf(f)?.status).toBe('cancelled');
    expect(runOf(f)?.jobs[0]?.status).toBe('cancelled');
    await expect(f.service.tool(id, 'collect_results', {})).rejects.toThrow(/não está recebendo/);
  });
  it('recovers running work as interrupted and never launches it merely by loading history', async () => {
    const f = setup();
    f.runtime.turn.mockImplementation(
      (request) =>
        new Promise((_resolve, reject) =>
          request.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }),
        ),
    );
    const id = await launch(f);
    await f.service.tool(id, 'delegate_task', { roleId: 'researcher', prompt: 'inspect', requestKey: 'one' });
    await vi.waitFor(() => expect(runOf(f)?.jobs[0]?.status).toBe('running'));
    const next = setup(f.service.snapshot());
    await next.service.load();
    expect(runOf(next)?.status).toBe('interrupted');
    expect(runOf(next)?.jobs[0]?.status).toBe('interrupted');
    expect(next.runtime.turn).not.toHaveBeenCalled();
  });
  it('blocks another run and invalid role configuration before launching models', async () => {
    const f = setup();
    await f.service.load();
    await expect(
      f.service.saveTeam({
        ...DEFAULT_TEAM,
        coordinator: { ...DEFAULT_TEAM.coordinator, access: 'workspace-write' },
      }),
    ).rejects.toThrow(/coordenador/);
    await expect(
      f.service.saveTeam({ ...DEFAULT_TEAM, workers: [DEFAULT_TEAM.coordinator] }),
    ).rejects.toThrow(/identificadores/);
    expect(f.runtime.turn).not.toHaveBeenCalled();
  });
  it('preserves an unreadable store and exposes the error without overwriting it at shutdown', async () => {
    const f = setup();
    f.store.load = async () => {
      throw new Error('corrupt');
    };
    await expect(f.service.load()).rejects.toThrow('corrupt');
    expect(f.service.snapshot().warning).toBe('corrupt');
    await expect(f.service.saveTeam(DEFAULT_TEAM)).rejects.toThrow(/armazenamento/);
    await f.service.shutdown();
    expect(f.store.save).not.toHaveBeenCalled();
  });
});
