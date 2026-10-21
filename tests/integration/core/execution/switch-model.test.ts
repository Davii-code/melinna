import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Execution } from '../../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../../support/execution-harness';
import { createTempRepo, type TempRepo } from '../../../support/git-fixture';
import { collector, enc, sleep, type Collector } from '../../../support/host-harness';

let h: CoreHarness;
let repo: TempRepo;

beforeEach(async () => {
  h = await createCoreHarness();
  repo = createTempRepo();
});

afterEach(async () => {
  await h.cleanup();
  repo.cleanup();
});

function exec(id: string): Execution {
  const e = h.model.execution(id);
  if (!e) throw new Error(`sem execução ${id}`);
  return e;
}

async function until(cond: () => boolean, what: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${what}`);
    await sleep(25);
  }
}

async function launch(agentId: string): Promise<{ id: string; col: Collector }> {
  const g = await h.workspace.createGroup('G');
  const task = await h.workspace.createTask({ groupId: g.id, repoPath: repo.root, baseRef: 'main', prompt: 'P' });
  const [r] = await h.executions.launch(task.id, [{ agentId }], { cols: 100, rows: 30 });
  if (!r?.ok) throw new Error('lançamento falhou');
  const col = collector();
  await h.executions.attach(r.execId, col.sink);
  await col.waitFor('pronto');
  await until(() => !h.executions.isBusy(r.execId), 'ocioso');
  return { id: r.execId, col };
}

describe('troca de modelo', () => {
  it('pty-command: an idle agent receives the command and the execution shows the new model', async () => {
    const { id, col } = await launch('fake');
    const plan = await h.executions.requestSwitch(id, 'model', 'esperto');
    expect(plan).toMatchObject({ kind: 'pty-command', waitsForIdle: false });
    await h.executions.confirmSwitch(id, plan.planId);
    await col.waitFor('model=esperto');
    expect(exec(id).model).toBe('esperto');
    expect(exec(id).pendingSwitch).toBeNull();
  });

  it('pty-command: a busy agent only receives the command after going idle', async () => {
    const { id, col } = await launch('fake');
    h.executions.write(id, enc('/busy 3000\r'));
    await until(() => h.executions.isBusy(id), 'ocupado');
    const plan = await h.executions.requestSwitch(id, 'model', 'esperto');
    expect(plan).toMatchObject({ kind: 'pty-command', waitsForIdle: true });
    await h.executions.confirmSwitch(id, plan.planId);
    expect(exec(id).pendingSwitch).toEqual({ kind: 'model', value: 'esperto' });
    await col.waitFor('model=esperto', 20_000);
    const text = col.text();
    expect(text.indexOf('model=esperto')).toBeGreaterThan(text.indexOf('busy-done'));
    await until(() => exec(id).pendingSwitch === null, 'pendente limpo');
    expect(exec(id).model).toBe('esperto');
  });

  it('cancelling a pending switch writes nothing', async () => {
    const { id, col } = await launch('fake');
    h.executions.write(id, enc('/busy 2000\r'));
    await until(() => h.executions.isBusy(id), 'ocupado');
    const plan = await h.executions.requestSwitch(id, 'model', 'esperto');
    await h.executions.confirmSwitch(id, plan.planId);
    h.executions.cancelPendingSwitch(id);
    expect(exec(id).pendingSwitch).toBeNull();
    await col.waitFor('busy-done', 10_000);
    await until(() => !h.executions.isBusy(id), 'ocioso');
    await sleep(500);
    expect(col.text()).not.toContain('model=');
    expect(exec(id).model).toBe('rapido');
  });

  it('restart-resume relaunches with resume args and the new model', async () => {
    const { id, col } = await launch('fake-resume');
    const plan = await h.executions.requestSwitch(id, 'model', 'esperto');
    expect(plan.kind).toBe('restart-resume');
    await h.executions.confirmSwitch(id, plan.planId);
    await col.waitFor('["--model","esperto","--resume"]');
    expect(exec(id).model).toBe('esperto');
    expect(exec(id).launchCount).toBe(2);
    expect(['running', 'idle']).toContain(exec(id).status);
  });

  it('unsupported relaunches without resume and keeps the history above a separator', async () => {
    const { id, col } = await launch('fake-nosw');
    const plan = await h.executions.requestSwitch(id, 'model', 'esperto');
    expect(plan).toMatchObject({ kind: 'restart-fresh', losesConversation: true });
    await h.executions.confirmSwitch(id, plan.planId);
    await col.waitFor('["--model","esperto"]');
    const text = col.text();
    expect(text).not.toContain('--resume');
    expect(text.indexOf('relançado em')).toBeGreaterThan(text.indexOf('pronto'));
    expect(exec(id).model).toBe('esperto');
  });

  it('rejects an unknown or stale plan', async () => {
    const { id } = await launch('fake');
    await expect(h.executions.confirmSwitch(id, 'nao-existe')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const plan = await h.executions.requestSwitch(id, 'model', 'esperto');
    await h.executions.confirmSwitch(id, plan.planId);
    await expect(h.executions.confirmSwitch(id, plan.planId)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});
