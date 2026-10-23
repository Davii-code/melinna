import type { FileRoot } from '../api-types';
import type { Execution, Group, Task } from '../persistence/state-schema';

export interface RootSources {
  groups: readonly Group[];
  tasks: readonly Task[];
  executions: readonly Execution[];
  /** Ids de pastas de workspace que não estão acessíveis agora; as demais contam como disponíveis. */
  unavailableFolders?: ReadonlySet<string>;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** Pastas de um workspace na ordem de navegação: a principal primeiro, depois as demais como foram adicionadas. */
function foldersOf(group: Group): { id: string | null; path: string; primary: boolean }[] {
  const folders = group.folders ?? [];
  if (folders.length === 0) {
    // grupo sem lista de pastas (estado antigo ainda não migrado): só o caminho do repositório
    return group.repoPath ? [{ id: null, path: group.repoPath, primary: true }] : [];
  }
  const primary = folders.find((f) => f.id === group.primaryFolderId) ?? folders[0];
  const ordered = primary ? [primary, ...folders.filter((f) => f !== primary)] : folders;
  return ordered.map((f) => ({ id: f.id, path: f.path, primary: f === primary }));
}

/**
 * Raízes que o explorador pode navegar: uma por pasta de cada workspace aberto (a principal primeiro) e o
 * worktree de cada execução. A mesma pasta em dois workspaces vira uma raiz só. Execução sem worktree
 * (nunca preparada ou já removida) não vira raiz.
 */
export function navigationRoots(sources: RootSources): FileRoot[] {
  const roots: FileRoot[] = [];
  const seen = new Set<string>();
  for (const group of sources.groups) {
    const folders = foldersOf(group);
    for (const folder of folders) {
      const key = folder.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const root: FileRoot = {
        path: folder.path,
        label: folders.length > 1 ? `${group.name} · ${baseName(folder.path)}` : group.name,
        kind: 'workspace',
      };
      if (folders.length > 1) {
        root.workspaceId = group.id;
        if (folder.primary) root.primary = true;
      }
      if (folder.id !== null && sources.unavailableFolders?.has(folder.id)) root.available = false;
      roots.push(root);
    }
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
      label: exec.command ? exec.command.label : task ? `${task.title} · ${exec.agentId}` : exec.agentId,
      kind: 'worktree',
      execId: exec.id,
    });
  }
  return roots;
}
