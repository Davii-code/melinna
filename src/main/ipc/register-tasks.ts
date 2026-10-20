import { freeSlots } from '../../core/execution/limits';
import type { ExecutionService } from '../../core/execution/execution-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseCreateAndLaunch } from './validate-tasks';

export function registerTasks(
  handle: Handle,
  deps: { workspace: WorkspaceService; executions: ExecutionService; log: Logger },
): void {
  const { workspace, executions, log } = deps;
  const C = CHANNELS.tasks;
  const groupExists = (id: string) => workspace.snapshot().groups.some((g) => g.id === id);
  handle(
    C.createAndLaunch,
    handler(
      log,
      C.createAndLaunch,
      parseCreateAndLaunch(groupExists, () => freeSlots(executions.liveCount())),
      async (input) => {
        const taskInput = {
          groupId: input.groupId,
          repoPath: input.repoPath,
          baseRef: input.baseRef,
          prompt: input.prompt,
        };
        const task = await workspace.createTask(
          input.title !== undefined ? { ...taskInput, title: input.title } : taskInput,
        );
        const results = await executions.launch(task.id, input.picks, input.size);
        return { taskId: task.id, results };
      },
    ),
  );
}
