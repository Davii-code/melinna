import type { CoordinatorService } from '../../core/coordinator/coordinator-service';
import { MelinnaError } from '../../core/errors';
import type { WorkflowService } from '../../core/workflow/workflow-service';
import { freeSlots } from '../../core/execution/limits';
import type { ExecutionService } from '../../core/execution/execution-service';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceService } from '../../core/workspace/workspace-service';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { parseAddExecution, parseCreateAndLaunch, parseGroupId, parseTaskId } from './validate-tasks';

export function registerTasks(
  handle: Handle,
  deps: {
    workspace: WorkspaceService;
    executions: ExecutionService;
    log: Logger;
    workflow?: WorkflowService;
    /** Ausente, sessões coordenadoras são recusadas. */
    coordinator?: Pick<CoordinatorService, 'enable'>;
  },
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
        if (input.coordinator && !deps.coordinator) {
          throw new MelinnaError('INPUT_INVALID', { userMessage: 'O coordenador não está disponível.' });
        }
        // Por padrão o agente roda na pasta escolhida: o terminal vê os arquivos e o histórico dela.
        // Com `worktree`, cada execução ganha um worktree e uma branch próprios a partir de `baseRef`.
        const selectedProfile = input.profileId
          ? deps.workflow?.getProfile(input.profileId, input.groupId)
          : null;
        const taskInput = {
          groupId: input.groupId,
          repoPath: input.repoPath,
          baseRef: input.baseRef,
          prompt: selectedProfile?.instructions
            ? selectedProfile.instructions + '\n\nObjetivo do usuário:\n' + input.prompt
            : input.prompt,
          // O coordenador grava os pedidos de worker na própria pasta: ele roda sempre direto nela.
          isolation: input.coordinator ? ('direct' as const) : (input.isolation ?? ('direct' as const)),
        };
        const task = await workspace.createTask(
          input.title !== undefined ? { ...taskInput, title: input.title } : taskInput,
        );
        await deps.workflow?.prepareTask(task.id, {
          objective: input.prompt,
          ...(input.profileId ? { profileId: input.profileId } : {}),
          ...(input.checkpointBeforeLaunch !== undefined
            ? { checkpointBeforeLaunch: input.checkpointBeforeLaunch }
            : {}),
        });
        const prompt = input.coordinator ? await deps.coordinator?.enable(task) : undefined;
        const results = await executions.launch(
          task.id,
          input.picks,
          input.size,
          prompt !== undefined ? { prompt } : {},
        );
        return { taskId: task.id, results };
      },
    ),
  );
  handle(
    C.addExecution,
    handler(
      log,
      C.addExecution,
      parseAddExecution(taskExists, () => freeSlots(executions.liveCount())),
      (taskId, p, size) => executions.launch(taskId, [p], size, { withPrompt: false }),
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
