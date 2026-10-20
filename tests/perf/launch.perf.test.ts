import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCoreHarness, type CoreHarness } from '../support/execution-harness';
import { createTempRepo, type TempRepo } from '../support/git-fixture';

let h: CoreHarness;
let repo: TempRepo;

beforeAll(async () => {
  h = await createCoreHarness();
  repo = createTempRepo({ generatedFiles: 1000 });
  // aquece o hospedeiro (fora da medição, como no app já aberto)
  await h.executions.context().hosts.get();
});

afterAll(async () => {
  await h.cleanup();
  repo.cleanup();
});

describe('SC-001', () => {
  it('6 executions in a 1,000-file repo: click to the 6th spawn in ≤ 6 s', async () => {
    const g = await h.workspace.createGroup('Perf');
    const started = performance.now();
    const task = await h.workspace.createTask({
      groupId: g.id,
      repoPath: repo.root,
      baseRef: 'main',
      prompt: 'medir',
    });
    const results = await h.executions.launch(
      task.id,
      Array.from({ length: 6 }, () => ({ agentId: 'fake' })),
      { cols: 100, rows: 30 },
    );
    const elapsed = performance.now() - started;
    expect(results.every((r) => r.ok)).toBe(true);
    expect(h.model.executionsOf(task.id).every((e) => e.pid !== null)).toBe(true);
    console.log(`SC-001: ${Math.round(elapsed)} ms até o 6º spawn`);
    expect(elapsed).toBeLessThanOrEqual(6000);
  });
});
