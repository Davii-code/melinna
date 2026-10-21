import { freeSlots } from '../../core/execution/limits';
import type { ExecutionService } from '../../core/execution/execution-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseCreateAndLaunch, parseGroupId, parseTaskId } from './validate-tasks';

export function registerTasks(
  handle: Handle,
  deps: { workspace: WorkspaceService; executions: ExecutionService; log: Logger },
): void {
  const { workspace, executions, log } = deps;
  const C = CHANNELS.tasks;
  const groupExists = (id: string) => workspace.snapshot().groups.some((g) => g.id === id);
  const taskExists = (id: string) => workspace.snapshot().tasks.some((t) => t.id === id);
  handle(
    C.createAndLaunch,
    handler(
      log,
      C.createAndLaunch,
      parseCreateAndLaunch(groupExists, () => freeSlots(executions.liveCount())),
      async (input) => {
        // O app sempre roda na pasta escolhida: o terminal vê os arquivos e o histórico do agente dela.
        const taskInput = {
          groupId: input.groupId,
          repoPath: input.repoPath,
          baseRef: input.baseRef,
          prompt: input.prompt,
          isolation: 'direct' as const,
        };
        const task = await workspace.createTask(
          input.title !== undefined ? { ...taskInput, title: input.title } : taskInput,
        );
        const results = await executions.launch(task.id, input.picks, input.size);
        return { taskId: task.id, results };
      },
    ),
  );
  handle(
    C.remove,
    handler(log, C.remove, parseTaskId(taskExists), (id) => executions.removeTask(id)),
  );
  handle(
    C.removeWorkspace,
    handler(log, C.removeWorkspace, parseGroupId(groupExists), async (id) => {
      await executions.removeTasksOf(id);
      workspace.removeGroup(id);
    }),
  );
}
