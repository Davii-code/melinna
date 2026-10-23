import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodePlatform } from '../../../src/adapters/node-platform';
import type { ExecutionService } from '../../../src/core/execution/execution-service';
import type { Execution } from '../../../src/core/persistence/state-schema';
import { RunService } from '../../../src/core/run/run-service';
import type { RunStarted } from '../../../src/core/run/types';
import { createCoreHarness, type CoreHarness } from '../../support/execution-harness';
import { collector, sleep } from '../../support/host-harness';

const SIZE = { cols: 100, rows: 30 };
const NODE_APP = join(__dirname, '..', '..', 'fixtures', 'projects', 'node-app');

let h: CoreHarness;
let run: RunService;
let groupId: string;

beforeEach(async () => {
  h = await createCoreHarness();
  const ws = await h.workspace.openWorkspace(NODE_APP);
  groupId = ws.id;
  run = new RunService({ executions: h.executions, platform: nodePlatform() });
});

afterEach(async () => {
  await h.cleanup();
});

function exec(id: string): Execution {
  const e = h.model.execution(id);
  if (!e) throw new Error(`sem execução ${id}`);
  return e;
}

async function waitStatus(id: string, statuses: string[], timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!statuses.includes(exec(id).status)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`status ${exec(id).status}, esperado ${statuses.join('|')}`);
    }
    await sleep(25);
  }
}

async function output(service: ExecutionService, execId: string) {
  const col = collector();
  await service.attach(execId, col.sink);
  return col;
}

async function startDev(): Promise<RunStarted> {
  const dev = (await run.list()).commands.find((c) => c.groupId === groupId && c.label === 'dev');
  if (!dev) throw new Error('sem a configuração "dev"');
  const r = await run.start(groupId, dev.id, SIZE);
  if ('needsConfirm' in r) throw new Error('pediu confirmação');
  return r;
}

describe('RunService com PTY real', () => {
  it('runs "npm run dev" of the node-app and keeps the output in the history', async () => {
    const r = await startDev();
    expect(exec(r.execId).command?.args.at(-2)).toBe('run');
    const col = await output(h.executions, r.execId);
    await col.waitFor('servidor de exemplo no ar');
    await h.executions.stop(r.execId);
    await waitStatus(r.execId, ['exited']);
  });

  it('reuses the live execution on a second start', async () => {
    const first = await startDev();
    const second = await startDev();
    expect(second).toEqual({ ...first, reused: true });
    expect(h.model.raw.executions).toHaveLength(1);
    await h.executions.stop(first.execId);
    await waitStatus(first.execId, ['exited']);
  });

  it('rerun writes the separator into the same history and runs again', async () => {
    const first = await startDev();
    const col = await output(h.executions, first.execId);
    await col.waitFor('servidor de exemplo no ar');
    await run.rerun(first.execId, SIZE);
    await col.waitFor('relançado em');
    await waitStatus(first.execId, ['running', 'idle']);
    expect(exec(first.execId).launchCount).toBe(2);
    await h.executions.stop(first.execId);
    await waitStatus(first.execId, ['exited']);
  });

  it('stops through executions.stop', async () => {
    const r = await startDev();
    await waitStatus(r.execId, ['running', 'idle']);
    await h.executions.stop(r.execId);
    await waitStatus(r.execId, ['exited']);
    expect(exec(r.execId).pid).toBeNull();
  });

  it('keeps an argument with spaces and quotes intact', async () => {
    const saved = await run.saveCommand(groupId, {
      label: 'Diz oi',
      program: 'node',
      args: ['-e', `console.log("oi mundo")`],
      folder: NODE_APP,
    });
    const r = await run.start(groupId, saved.id, SIZE);
    if ('needsConfirm' in r) throw new Error('pediu confirmação');
    const col = await output(h.executions, r.execId);
    await col.waitFor('oi mundo');
    await waitStatus(r.execId, ['exited']);
    expect(exec(r.execId).exitCode).toBe(0);
  });

  it('fails with PROGRAM_NOT_FOUND for a program that does not exist', async () => {
    const saved = await run.saveCommand(groupId, {
      label: 'Fantasma',
      program: 'programa-que-nao-existe-melinna',
      args: [],
      folder: NODE_APP,
    });
    await expect(run.start(groupId, saved.id, SIZE)).rejects.toMatchObject({ code: 'PROGRAM_NOT_FOUND' });
  });

  it('force-ends a process that ignores Ctrl+C after the stop deadline', async () => {
    const saved = await run.saveCommand(groupId, {
      label: 'Teimoso',
      program: 'node',
      args: [
        '-e',
        `process.on('SIGINT', () => {}); console.log('teimoso no ar'); setInterval(() => {}, 1000)`,
      ],
      folder: NODE_APP,
    });
    const r = await run.start(groupId, saved.id, SIZE);
    if ('needsConfirm' in r) throw new Error('pediu confirmação');
    const col = await output(h.executions, r.execId);
    await col.waitFor('teimoso no ar');
    const stoppedAt = Date.now();
    await h.executions.stop(r.execId);
    await waitStatus(r.execId, ['exited'], 15_000);
    expect(Date.now() - stoppedAt).toBeLessThan(12_000);
  }, 30_000);

  it('after the service restarts, reconciles the live command and still reruns it', async () => {
    const first = await startDev();
    const col = await output(h.executions, first.execId);
    await col.waitFor('servidor de exemplo no ar');
    const restarted = h.restartExecutions();
    await restarted.reconcileWithHost();
    expect(exec(first.execId).status).toBe('running');
    expect(exec(first.execId).command).toMatchObject({ label: 'dev' });
    const again = new RunService({ executions: restarted, platform: nodePlatform() });
    await again.rerun(first.execId, SIZE);
    await waitStatus(first.execId, ['running', 'idle']);
    expect(exec(first.execId).launchCount).toBe(2);
    await restarted.stop(first.execId);
    await waitStatus(first.execId, ['exited']);
  }, 30_000);
});
