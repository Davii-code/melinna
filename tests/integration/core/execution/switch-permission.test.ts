import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Execution } from '../../../../src/core/persistence/state-schema';
import { createCoreHarness, type CoreHarness } from '../../../support/execution-harness';
import { createTempRepo, type TempRepo } from '../../../support/git-fixture';
import { collector, sleep, type Collector } from '../../../support/host-harness';

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

async function launch(agentId: string): Promise<{ id: string; col: Collector }> {
  const g = await h.workspace.createGroup('G');
  const task = await h.workspace.createTask({ groupId: g.id, repoPath: repo.root, baseRef: 'main', prompt: 'P' });
  const [r] = await h.executions.launch(task.id, [{ agentId }], { cols: 100, rows: 30 });
  if (!r?.ok) throw new Error('lançamento falhou');
  const col = collector();
  await h.executions.attach(r.execId, col.sink);
  await col.waitFor('pronto');
  const start = Date.now();
  while (h.executions.isBusy(r.execId)) {
    if (Date.now() - start > 10_000) throw new Error('não ficou ocioso');
    await sleep(25);
  }
  return { id: r.execId, col };
}

describe('troca de modo de permissão (caso de borda 12)', () => {
  it('pty-command sends the permission command', async () => {
    const { id, col } = await launch('fake');
    const plan = await h.executions.requestSwitch(id, 'permission', 'livre');
    expect(plan).toMatchObject({ kind: 'pty-command', dangerous: true });
    await h.executions.confirmSwitch(id, plan.planId);
    await col.waitFor('permission=livre');
    expect(exec(id).permissionMode).toBe('livre');
  });

  it('restart-resume relaunches with the new mode args and resume args', async () => {
    const { id, col } = await launch('fake-resume');
    const plan = await h.executions.requestSwitch(id, 'permission', 'livre');
    expect(plan).toMatchObject({ kind: 'restart-resume', dangerous: true });
    await h.executions.confirmSwitch(id, plan.planId);
    await col.waitFor('["--yolo","--model","rapido","--resume"]');
    expect(exec(id).permissionMode).toBe('livre');
  });

  it('unsupported relaunches without resume', async () => {
    const { id, col } = await launch('fake-nosw');
    const plan = await h.executions.requestSwitch(id, 'permission', 'livre');
    expect(plan).toMatchObject({ kind: 'restart-fresh', losesConversation: true });
    await h.executions.confirmSwitch(id, plan.planId);
    await col.waitFor('["--yolo","--model","rapido"]');
    expect(col.text()).not.toContain('--resume');
    expect(exec(id).permissionMode).toBe('livre');
  });
});
