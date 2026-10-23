import { MelinnaError } from '../errors';
import type { ExecutionContext } from '../execution/context';
import type { ExecutionService } from '../execution/execution-service';
import { STOP_GRACE_MS } from '../execution/lifecycle';
import { assertWithinLimit } from '../execution/limits';
import { createCommandExecutionRecord, prepareExecution } from '../execution/prepare';
import { startExecution } from '../execution/start';
import { isLive } from '../execution/state-machine';
import { slugify } from '../git/branch-name';
import { newId } from '../ids';
import { pathModule, repoIdOf } from '../paths';
import type { Execution, Group, Task } from '../persistence/state-schema';
import type { Platform } from '../ports/platform';
import { removeCustomCommand, saveCustomCommand, describeCustom, workspaceFolders } from './custom-commands';
import { detectFolders, type DetectDeps } from './detect';
import { resolveProgram } from './resolve-program';
import type {
  ExecutionCommand,
  RunCatalog,
  RunChoice,
  RunCommand,
  RunCommandInput,
  RunNeedsConfirm,
  RunStarted,
} from './types';

export interface RunServiceDeps {
  executions: ExecutionService;
  platform: Platform;
}

/** Programa e argumentos prontos para o hospedeiro lançar, sem shell. */
interface LaunchSpec {
  file: string;
  args: string[];
}

const TASK_TITLE_MAX = 120;
const STOP_WAIT_MS = STOP_GRACE_MS + 3000;

function stale(): MelinnaError {
  return new MelinnaError('COMMAND_STALE');
}

function mustStop(): MelinnaError {
  return new MelinnaError('EXECUTION_RUNNING', { userMessage: 'Pare o comando antes.' });
}

/**
 * Configurações de execução: junta as personalizadas e as detectadas de todos os workspaces e roda uma
 * delas como execução de comando (mesmo PTY das sessões, sem shell). O renderer só envia ids; o programa e
 * os argumentos são resolvidos aqui a cada lançamento.
 */
export class RunService {
  private readonly ctx: ExecutionContext;
  private readonly detectDeps: DetectDeps;

  constructor(private readonly deps: RunServiceDeps) {
    this.ctx = deps.executions.context();
    this.detectDeps = { fs: this.ctx.fs, platform: deps.platform };
    deps.executions.onExit((e) => {
      const exec = this.ctx.model.execution(e.execId);
      if (!exec?.command) return;
      const groupId = this.ctx.model.task(exec.taskId)?.groupId;
      if (groupId) this.ctx.log.info('run.stopped', { groupId, exitCode: e.exitCode });
    });
  }

  /** Configurações de todos os workspaces: por workspace, as personalizadas antes das detectadas. */
  async list(): Promise<RunCatalog> {
    const groups = [...this.ctx.model.raw.groups].sort((a, b) => a.order - b.order);
    const parts = await Promise.all(groups.map((g) => this.catalogOf(g)));
    return {
      commands: parts.flatMap((p) => p.commands),
      warnings: parts.flatMap((p) => p.warnings),
    };
  }

  /**
   * Roda a configuração. Se já roda, devolve a execução existente; se a anterior terminou, relança a
   * mesma (mesmo painel); senão cria a sessão de comando. Um wrapper do projeto sem permissão de execução
   * pede a escolha do usuário antes de qualquer coisa ser criada.
   */
  start(
    groupId: string,
    commandId: string,
    size: { cols: number; rows: number },
    choice?: RunChoice,
  ): Promise<RunStarted | RunNeedsConfirm> {
    return this.ctx.mutex.run(this.key(groupId, commandId), async () => {
      const prior = this.executionOf(groupId, commandId);
      if (prior && isLive(prior.status)) {
        this.ctx.log.info('run.started', { groupId, reused: true });
        return { taskId: prior.taskId, execId: prior.id, reused: true };
      }
      const command = await this.find(groupId, commandId);
      const spec = await this.launchSpec(command, choice);
      if ('needsConfirm' in spec) return spec;
      const execCommand = this.executionCommand(command, spec);
      if (prior) {
        this.ctx.update(prior.id, { command: execCommand });
        await this.deps.executions.relaunch(prior.id, size);
        this.logStarted(command);
        return { taskId: prior.taskId, execId: prior.id, reused: false };
      }
      assertWithinLimit(this.ctx.model.liveCount(), 1);
      const task = this.createTask(command);
      const exec = createCommandExecutionRecord(this.ctx, task, execCommand);
      await prepareExecution(this.ctx, task, exec, new Set());
      await startExecution(this.ctx, this.ctx.model.execution(exec.id) ?? exec, size, {});
      this.logStarted(command);
      return { taskId: task.id, execId: exec.id, reused: false };
    });
  }

  /** Para (se viva) e relança a execução de comando, com a configuração resolvida de novo. */
  async rerun(execId: string, size: { cols: number; rows: number }): Promise<void> {
    const exec = this.ctx.model.execution(execId);
    const groupId = exec ? this.ctx.model.task(exec.taskId)?.groupId : undefined;
    if (!exec?.command || !groupId) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Esta execução não é um comando.' });
    }
    const commandId = exec.command.commandId;
    await this.ctx.mutex.run(this.key(groupId, commandId), async () => {
      // Resolve antes de parar: configuração sumida ou programa ausente não derruba o que está rodando.
      const command = await this.find(groupId, commandId);
      const spec = await this.launchSpec(command, undefined);
      if ('needsConfirm' in spec) {
        throw new MelinnaError('INPUT_INVALID', {
          userMessage:
            'O wrapper do projeto não tem permissão de execução; rode pelo seletor para escolher como seguir.',
        });
      }
      await this.stopAndWait(execId);
      this.ctx.update(execId, { command: this.executionCommand(command, spec) });
      await this.deps.executions.relaunch(execId, size);
      this.logStarted(command);
    });
  }

  async saveCommand(groupId: string, input: RunCommandInput): Promise<RunCommand> {
    const { stored, created } = saveCustomCommand(this.ctx.model, groupId, input, this.ctx.os);
    this.ctx.log.info('run.command_saved', { groupId, created });
    return describeCustom(stored, this.requireGroup(groupId), this.detectDeps);
  }

  removeCommand(groupId: string, commandId: string): Promise<void> {
    return this.ctx.mutex.run(this.key(groupId, commandId), async () => {
      const prior = this.executionOf(groupId, commandId);
      if (prior && isLive(prior.status)) throw mustStop();
      removeCustomCommand(this.ctx.model, groupId, commandId);
      this.ctx.log.info('run.command_removed', { groupId });
    });
  }

  private key(groupId: string, commandId: string): string {
    return `run:${groupId}:${commandId}`;
  }

  private requireGroup(groupId: string): Group {
    const group = this.ctx.model.group(groupId);
    if (!group) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Workspace não encontrado.' });
    return group;
  }

  private async catalogOf(group: Group): Promise<RunCatalog> {
    const [custom, detected] = await Promise.all([
      Promise.all((group.commands ?? []).map((c) => describeCustom(c, group, this.detectDeps))),
      detectFolders(
        this.detectDeps,
        workspaceFolders(group).map((folder) => ({ groupId: group.id, folder })),
      ),
    ]);
    return { commands: [...custom, ...detected.commands], warnings: detected.warnings };
  }

  /** A configuração de hoje com esse id; `COMMAND_STALE` se o arquivo de projeto ou o cadastro mudou. */
  private async find(groupId: string, commandId: string): Promise<RunCommand> {
    const group = this.ctx.model.group(groupId);
    if (!group) throw stale();
    const storedCustom = (group.commands ?? []).find((c) => c.id === commandId);
    if (storedCustom) return describeCustom(storedCustom, group, this.detectDeps);
    const found = (await this.catalogOf(group)).commands.find((c) => c.id === commandId);
    if (!found) throw stale();
    return found;
  }

  /** A última execução dessa configuração neste workspace (viva ou encerrada). */
  private executionOf(groupId: string, commandId: string): Execution | undefined {
    const { model } = this.ctx;
    const matches = model.raw.executions.filter(
      (e) => e.command?.commandId === commandId && model.task(e.taskId)?.groupId === groupId,
    );
    return matches.at(-1);
  }

  private executionCommand(command: RunCommand, spec: LaunchSpec): ExecutionCommand {
    return { commandId: command.id, label: command.label, file: spec.file, args: spec.args };
  }

  private createTask(command: RunCommand): Task {
    const title = command.label.slice(0, TASK_TITLE_MAX);
    const task: Task = {
      id: newId(),
      groupId: command.groupId,
      title,
      prompt: '',
      repoPath: command.folder,
      repoId: repoIdOf(command.folder, this.ctx.os),
      baseRef: '',
      baseCommit: '',
      slug: slugify(title),
      createdAt: this.ctx.clock.now().toISOString(),
      isolation: 'direct',
      kind: 'command',
    };
    this.ctx.model.mutate((s) => s.tasks.push(task));
    return task;
  }

  /** `mvnw`/`gradlew` do projeto (caminho absoluto): é o único programa que pede escolha sem permissão. */
  private wrapperTool(program: string): 'mvn' | 'gradle' | null {
    const p = pathModule(this.ctx.os);
    if (!p.isAbsolute(program)) return null;
    const name = p.basename(program).toLowerCase();
    return name === 'mvnw' ? 'mvn' : name === 'gradlew' ? 'gradle' : null;
  }

  private async launchSpec(
    command: RunCommand,
    choice: RunChoice | undefined,
  ): Promise<LaunchSpec | RunNeedsConfirm> {
    if (command.unavailableReason === 'folder-outside') {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'A pasta precisa ser do workspace.' });
    }
    const { platform } = this.deps;
    const resolved = await resolveProgram(command.program, platform, this.ctx.fs);
    const systemTool = this.wrapperTool(command.program);
    const needsChoice = systemTool !== null && !resolved.executable;
    if (choice !== undefined && !needsChoice) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: 'Esta configuração não precisa dessa escolha.',
      });
    }
    if (needsChoice) {
      if (choice === undefined) return { needsConfirm: 'wrapper-sh', wrapper: command.program };
      if (choice === 'wrapper-sh') {
        const sh = await resolveProgram('sh', platform, this.ctx.fs);
        return { file: sh.file, args: [...sh.prefixArgs, command.program, ...command.args] };
      }
      const tool = await resolveProgram(systemTool, platform, this.ctx.fs);
      return { file: tool.file, args: [...tool.prefixArgs, ...command.args] };
    }
    if (!resolved.executable) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: `${command.program} não tem permissão de execução.`,
      });
    }
    return { file: resolved.file, args: [...resolved.prefixArgs, ...command.args] };
  }

  /** Para a execução e espera o hospedeiro confirmar o término (Ctrl+C e, após o prazo, encerramento forçado). */
  private async stopAndWait(execId: string): Promise<void> {
    const alive = () => {
      const status = this.ctx.model.execution(execId)?.status;
      return status !== undefined && isLive(status);
    };
    if (!alive()) return;
    let off: () => void = () => undefined;
    const ended = new Promise<void>((resolve) => {
      off = this.deps.executions.onEnded((id) => {
        if (id === execId) resolve();
      });
    });
    try {
      await this.deps.executions.stop(execId);
      if (!alive()) return;
      let cancel: () => void = () => undefined;
      const timeout = new Promise<void>((resolve) => {
        cancel = this.ctx.clock.setTimeout(resolve, STOP_WAIT_MS);
      });
      await Promise.race([ended, timeout]);
      cancel();
      if (alive()) throw mustStop();
    } finally {
      off();
    }
  }

  private logStarted(command: RunCommand): void {
    this.ctx.log.info('run.started', {
      groupId: command.groupId,
      source: command.source,
      tool: command.tool,
      reused: false,
    });
  }
}
