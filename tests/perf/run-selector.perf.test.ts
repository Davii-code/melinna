import { describe, expect, it } from 'vitest';
import { buildSelectorModel } from '../../src/renderer/components/Run/selector-model';
import type { Group, RunConfigTool, RunConfigView } from '../../src/shared/ipc-contract';

const BUDGET_MS = 200;
const TOOLS: RunConfigTool[] = ['npm', 'pnpm', 'maven', 'gradle', 'compose', 'program'];

const groups: Group[] = [
  { id: 'g1', name: 'App', order: 0, folders: [{ id: 'f1', path: '/repo' }], primaryFolderId: 'f1' },
  { id: 'g2', name: 'Outro', order: 1, folders: [{ id: 'f2', path: '/other' }], primaryFolderId: 'f2' },
];

function configs(count: number): RunConfigView[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    groupId: i % 2 === 0 ? 'g1' : 'g2',
    name: `Configuração ${i}`,
    tool: TOOLS[i % TOOLS.length] as RunConfigTool,
    folder: '/repo',
    script: 'dev',
    program: 'npm',
    args: [],
    runtimeOptions: '',
    env: [],
    beforeLaunch: null,
    allowParallel: false,
    folderGroup: i % 5 === 0 ? 'Agrupadas' : null,
    order: i,
    available: i % 7 !== 0,
    unavailableReason: i % 7 === 0 ? 'program-missing' : null,
    searched: 'mvn',
    running: i % 11 === 0 ? 1 : 0,
  }));
}

describe('run selector performance', () => {
  it('builds what the selector shows for 50 saved configs in under 200 ms', () => {
    const list = configs(50);
    buildSelectorModel(list, groups, []); // aquece o JIT
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const model = buildSelectorModel(list, groups, []);
      times.push(performance.now() - start);
      expect(model.flatMap((w) => w.tools.flatMap((t) => t.configs))).toHaveLength(50);
    }
    times.sort((a, b) => a - b);
    expect(times[2]).toBeLessThan(BUDGET_MS);
  });
});
