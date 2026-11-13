import type { AgentPick, TermSize } from '../api-types';
import { assertWithinLimit } from '../execution/limits';
import { MelinnaError } from '../errors';
import type { ExecutionService } from '../execution/execution-service';
import type { WorkspaceService } from './workspace-service';

/** Tamanho do terminal de uma sessão aberta sem janela à vista; o painel ajusta ao ser mostrado. */
export const BACKGROUND_TERM_SIZE: TermSize = { cols: 120, rows: 30 };

export interface LaunchSessionInput {
  /** Pasta da sessão: vira (ou reaproveita) um workspace. */
  folder: string;
  agentId: string;
  prompt: string;
  title?: string;
  isolation: 'direct' | 'worktree';
  model?: string;
  permission?: string;
}

export interface LaunchedSession {
  taskId: string;
  execId: string;
}

export interface SessionLauncherDeps {
  workspace: Pick<WorkspaceService, 'openWorkspace' | 'createTask'>;
  executions: Pick<ExecutionService, 'launch' | 'liveCount' | 'removeTask'>;
}

/**
 * Abre uma sessão sem passar pela tela de nova tarefa: usada pelas automações agendadas e pelo agente
 * coordenador. Faz o mesmo caminho da tela (workspace da pasta, tarefa, uma execução do agente).
 */
export class SessionLauncher {
  constructor(private readonly deps: SessionLauncherDeps) {}

  async launch(input: LaunchSessionInput): Promise<LaunchedSession> {
    const { workspace, executions } = this.deps;
    assertWithinLimit(executions.liveCount(), 1);
    const group = await workspace.openWorkspace(input.folder);
    if (!group.repoPath) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'O workspace aberto não tem pasta.' });
    }
    assertWithinLimit(executions.liveCount(), 1);
    const task = await workspace.createTask({
      groupId: group.id,
      repoPath: group.repoPath,
      baseRef: 'HEAD',
      prompt: input.prompt,
      isolation: input.isolation,
      ...(input.title !== undefined ? { title: input.title } : {}),
    });
    const pick: AgentPick = { agentId: input.agentId };
    if (input.model !== undefined) pick.model = input.model;
    if (input.permission !== undefined) pick.permission = input.permission;
    let results: Awaited<ReturnType<ExecutionService['launch']>>;
    try {
      results = await executions.launch(task.id, [pick], BACKGROUND_TERM_SIZE);
    } catch (error) {
      if (error instanceof MelinnaError && error.code === 'LIMIT_REACHED') {
        await executions.removeTask(task.id);
      }
      throw error;
    }
    const [result] = results;
    if (!result || !result.ok) {
      throw new MelinnaError(result?.error.code ?? 'INTERNAL', {
        ...(result ? { userMessage: result.error.message } : {}),
        details: { taskId: task.id },
      });
    }
    return { taskId: task.id, execId: result.execId };
  }
}
