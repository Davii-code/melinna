import type { FileRoot } from '../api-types';
import type { Execution, Group, Task } from '../persistence/state-schema';

export interface RootSources {
  groups: readonly Group[];
  tasks: readonly Task[];
  executions: readonly Execution[];
}

/**
 * Raízes que o explorador pode navegar: o repositório de cada workspace aberto e o worktree de cada
 * execução. Execução sem worktree (nunca preparada ou já removida) não vira raiz.
 */
export function navigationRoots(sources: RootSources): FileRoot[] {
  const roots: FileRoot[] = [];
  const seen = new Set<string>();
  for (const group of sources.groups) {
    if (!group.repoPath) continue;
    const key = group.repoPath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ path: group.repoPath, label: group.name, kind: 'workspace' });
  }
  const taskById = new Map(sources.tasks.map((t) => [t.id, t]));
  for (const exec of sources.executions) {
    if (exec.worktreePath === '') continue;
    const key = exec.worktreePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const task = taskById.get(exec.taskId);
    roots.push({
      path: exec.worktreePath,
      label: task ? `${task.title} · ${exec.agentId}` : exec.agentId,
      kind: 'worktree',
      execId: exec.id,
    });
  }
  return roots;
}
