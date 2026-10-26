import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodePlatform } from '../../../src/adapters/node-platform';
import type { ExecutionService } from '../../../src/core/execution/execution-service';
import type { Execution } from '../../../src/core/persistence/state-schema';
import { RunService } from '../../../src/core/run/run-service';
import type { RunConfigInput, RunStarted } from '../../../src/core/run/types';
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

const config = (over: Partial<RunConfigInput> = {}): RunConfigInput => ({
  name: 'Config',
  tool: 'program',
  folder: NODE_APP,
  script: null,
  program: 'node',
  args: [],
  runtimeOptions: '',
  env: [],
  beforeLaunch: null,
  allowParallel: false,
  folderGroup: null,
  ...over,
});

const npm = (script: string, over: Partial<RunConfigInput> = {}) =>
  config({ name: script, tool: 'npm', script, program: '', ...over });

async function started(r: Promise<RunStarted | { needsConfirm: string }>): Promise<RunStarted> {
  const value = await r;
  if ('needsConfirm' in value) throw new Error('pediu confirmação');
  return value;
}

async function startDev(): Promise<RunStarted> {
  const saved = await run.saveConfig(groupId, npm('dev'));
  return started(run.start(groupId, saved.id, SIZE));
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
    const saved = await run.saveConfig(groupId, npm('dev'));
    const first = await started(run.start(groupId, saved.id, SIZE));
    const second = await started(run.start(groupId, saved.id, SIZE));
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
    const saved = await run.saveConfig(
      groupId,
      config({ name: 'Diz oi', args: ['-e', `console.log("oi mundo")`] }),
    );
    const r = await started(run.start(groupId, saved.id, SIZE));
    const col = await output(h.executions, r.execId);
    await col.waitFor('oi mundo');
    await waitStatus(r.execId, ['exited']);
    expect(exec(r.execId).exitCode).toBe(0);
  });

  it('fails with PROGRAM_NOT_FOUND for a program that does not exist', async () => {
    const saved = await run.saveConfig(
      groupId,
      config({ name: 'Fantasma', program: 'programa-que-nao-existe-melinna' }),
    );
    await expect(run.start(groupId, saved.id, SIZE)).rejects.toMatchObject({ code: 'PROGRAM_NOT_FOUND' });
  });

  it('force-ends a process that ignores Ctrl+C after the stop deadline', async () => {
    const saved = await run.saveConfig(
      groupId,
      config({
        name: 'Teimoso',
        args: [
          '-e',
          `process.on('SIGINT', () => {}); console.log('teimoso no ar'); setInterval(() => {}, 1000)`,
        ],
      }),
    );
    const r = await started(run.start(groupId, saved.id, SIZE));
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

describe('RunService — ambiente e opções do runtime', () => {
  it('gives the real process the variables of the config and NODE_OPTIONS from runtimeOptions', async () => {
    const saved = await run.saveConfig(
      groupId,
      npm('start', {
        runtimeOptions: '--max-old-space-size=256',
        env: [{ name: 'PORT', value: '4000' }],
      }),
    );
    const r = await started(run.start(groupId, saved.id, SIZE));
    const col = await output(h.executions, r.execId);
    await col.waitFor('PORT=4000 OPTS=--max-old-space-size=256');
    await waitStatus(r.execId, ['exited']);
    expect(exec(r.execId).exitCode).toBe(0);
  });

  it('keeps the variables on a rerun from the saved execution', async () => {
    const saved = await run.saveConfig(groupId, npm('start', { env: [{ name: 'PORT', value: '5000' }] }));
    const r = await started(run.start(groupId, saved.id, SIZE));
    const col = await output(h.executions, r.execId);
    await col.waitFor('PORT=5000');
    await waitStatus(r.execId, ['exited']);
    await run.saveConfig(groupId, {
      ...npm('start', { env: [{ name: 'PORT', value: '6000' }] }),
      id: saved.id,
    });
    await run.rerun(r.execId, SIZE);
    await col.waitFor('PORT=6000');
  });

  it('never leaks the variable values into the log', async () => {
    await run.saveConfig(groupId, npm('start', { env: [{ name: 'API_TOKEN', value: 'valor-secreto-xyz' }] }));
    const saved = h.model.group(groupId)?.runConfigs?.[0];
    await started(run.start(groupId, saved?.id ?? '', SIZE));
    expect(h.log.text()).not.toContain('valor-secreto-xyz');
  });
});

describe('RunService — antes de lançar', () => {
  it('runs the step first, waits for it and only then runs the main config', async () => {
    const step = await run.saveConfig(groupId, npm('start', { env: [{ name: 'PORT', value: '7000' }] }));
    const main = await run.saveConfig(groupId, npm('dev', { beforeLaunch: step.id }));
    const r = await started(run.start(groupId, main.id, SIZE));
    const stepExec = h.model.raw.executions.find((e) => e.command?.commandId === step.id);
    expect(stepExec).toBeDefined();
    expect(stepExec?.status).toBe('exited');
    expect(stepExec?.exitCode).toBe(0);
    const col = await output(h.executions, r.execId);
    await col.waitFor('servidor de exemplo no ar');
    await h.executions.stop(r.execId);
    await waitStatus(r.execId, ['exited']);
  }, 30_000);

  it('does not run the main config when the step exits with 1', async () => {
    const step = await run.saveConfig(groupId, npm('fail'));
    const main = await run.saveConfig(groupId, npm('dev', { beforeLaunch: step.id }));
    await expect(run.start(groupId, main.id, SIZE)).rejects.toMatchObject({
      code: 'RUN_BEFORE_LAUNCH_FAILED',
      details: { name: 'fail', exitCode: 1, reason: 'exit' },
    });
    expect(h.model.raw.executions.some((e) => e.command?.commandId === main.id)).toBe(false);
  }, 30_000);
});

describe('RunService — sem shell', () => {
  it('delivers "& calc" and quotes to the process as literal arguments', async () => {
    const saved = await run.saveConfig(
      groupId,
      config({
        name: 'Literal',
        args: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '& calc', 'a "b" c', '$(echo x)'],
      }),
    );
    const r = await started(run.start(groupId, saved.id, SIZE));
    const col = await output(h.executions, r.execId);
    await col.waitFor('["& calc","a \\"b\\" c","$(echo x)"]');
    await waitStatus(r.execId, ['exited']);
    expect(exec(r.execId).exitCode).toBe(0);
  });
});
