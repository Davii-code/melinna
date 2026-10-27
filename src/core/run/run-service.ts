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
import { chainOf } from './before-launch';
import { detectFolders, type DetectDeps } from './detect';
import { BATCH_PROGRAM_MESSAGE, resolveProgram } from './resolve-program';
import { envNames } from './run-env';
import {
  folderOfWorkspace,
  launchPlan,
  removeConfig,
  reorder,
  saveConfig,
  toView,
  workspaceFolders,
} from './run-configs';
import type {
  ExecutionCommand,
  RunChoice,
  RunConfig,
  RunConfigInput,
  RunConfigView,
  RunListing,
  RunNeedsConfirm,
  RunReorderItem,
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

type SpecOrConfirm = { spec: LaunchSpec; usedChoice: boolean } | RunNeedsConfirm;

const TASK_TITLE_MAX = 120;
const STOP_WAIT_MS = STOP_GRACE_MS + 3000;

function stale(): MelinnaError {
  return new MelinnaError('COMMAND_STALE');
}

function mustStop(): MelinnaError {
  return new MelinnaError('EXECUTION_RUNNING', { userMessage: 'Pare o comando antes.' });
}

function beforeLaunchFailed(
  name: string,
  reason: 'exit' | 'cancelled' | 'already-running',
  exitCode: number | null = null,
): MelinnaError {
  const text =
    reason === 'exit'
      ? `terminou com código ${exitCode ?? '?'}`
      : reason === 'cancelled'
        ? 'foi cancelada'
        : 'já está rodando';
  return new MelinnaError('RUN_BEFORE_LAUNCH_FAILED', {
    userMessage: `A etapa "${name}" de "Antes de lançar" ${text}; a configuração não foi lançada.`,
    details: { name, reason, exitCode },
  });
}

/**
 * Configurações de execução: as salvas de cada workspace (com ambiente, opções do runtime, "antes de
 * lançar" e várias instâncias) e os scripts detectados nas pastas, que só servem de origem para criar uma
 * salva. Roda uma delas como execução de comando (mesmo PTY das sessões, sem shell). O renderer só envia
 * ids; o programa e os argumentos são resolvidos aqui a cada lançamento.
 */
export class RunService {
  private readonly verificationRuns = new Map<string, { cancelled: boolean; activeId: string | null }>();
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

  /** Configurações salvas de todos os workspaces e os scripts detectados nas pastas deles. */
  async list(): Promise<RunListing> {
    const groups = [...this.ctx.model.raw.groups].sort((a, b) => a.order - b.order);
    const parts = await Promise.all(
      groups.map(async (group) => {
        const saved = group.runConfigs ?? [];
        const [configs, detected] = await Promise.all([
          Promise.all(saved.map((c) => this.view(c, group, saved))),
          detectFolders(
            this.detectDeps,
            workspaceFolders(group).map((folder) => ({ groupId: group.id, folder })),
          ),
        ]);
        return { configs, detected: detected.commands, warnings: detected.warnings };
      }),
    );
    return {
      configs: parts.flatMap((p) => p.configs),
      detected: parts.flatMap((p) => p.detected),
      warnings: parts.flatMap((p) => p.warnings),
    };
  }

  /**
   * Roda a configuração. Se já roda e não permite várias instâncias, devolve a execução existente; se a
   * anterior terminou, relança a mesma (mesmo painel); senão cria a sessão de comando. Antes dela rodam, em
   * ordem, as etapas de "antes de lançar": cada uma é uma execução comum, esperada até o fim, e só código 0
   * segue. Um wrapper do projeto sem permissão de execução, em qualquer ponto da cadeia, pede a escolha do
   * usuário antes de qualquer etapa rodar.
   */
  start(
    groupId: string,
    configId: string,
    size: { cols: number; rows: number },
    choice?: RunChoice,
  ): Promise<RunStarted | RunNeedsConfirm> {
    return this.ctx.mutex.run(this.key(groupId, configId), async () => {
      const group = this.ctx.model.group(groupId);
      const configs = group?.runConfigs ?? [];
      const main = configs.find((c) => c.id === configId);
      if (!group || !main) throw stale();
      const chain = chainOf(configs, configId);
      const live = this.instancesOf(groupId, configId).filter((e) => isLive(e.status));
      const liveMain = live.at(-1);
      if (liveMain && !main.allowParallel) {
        this.ctx.log.info('run.reused', { groupId, configId });
        return { taskId: liveMain.taskId, execId: liveMain.id, reused: true };
      }
      const specs: LaunchSpec[] = [];
      let usedChoice = false;
      for (const config of chain) {
        const result = await this.specOf(config, group, choice);
        if ('needsConfirm' in result) return result;
        usedChoice ||= result.usedChoice;
        specs.push(result.spec);
      }
      if (choice !== undefined && !usedChoice) {
        throw new MelinnaError('INPUT_INVALID', {
          userMessage: 'Esta configuração não precisa dessa escolha.',
        });
      }
      for (const [i, step] of chain.slice(0, -1).entries()) {
        await this.runStep(step, group, specs[i] as LaunchSpec, size);
      }
      return this.launch(main, group, specs[chain.length - 1] as LaunchSpec, size, chain.length - 1);
    });
  }

  /** Runs saved configuration chains against the selected agent's actual files, never another checkout. */
  async startVerification(
    sourceExecutionId: string,
    configId: string,
    size: { cols: number; rows: number },
    verificationId: string,
    choice?: RunChoice,
  ): Promise<RunStarted | RunNeedsConfirm> {
    const source = this.ctx.model.execution(sourceExecutionId);
    const task = source ? this.ctx.model.task(source.taskId) : undefined;
    const group = task ? this.ctx.model.group(task.groupId) : undefined;
    if (!source || !task || !group || source.command) throw stale();
    const chain = chainOf(group.runConfigs ?? [], configId);
    const p = pathModule(this.ctx.os);
    const configs = chain.map((config) => {
      const rel = p.relative(task.repoPath, config.folder);
      const inside = rel === '' || (!rel.startsWith('..' + p.sep) && rel !== '..' && !p.isAbsolute(rel));
      if (!inside && !(task.extraDirs ?? []).includes(config.folder))
        throw new MelinnaError('INPUT_INVALID', {
          userMessage: 'A configuração precisa usar uma pasta desta tarefa.',
        });
      const folder = inside ? p.join(source.worktreePath, rel) : config.folder;
      const programRel = p.isAbsolute(config.program) ? p.relative(task.repoPath, config.program) : null;
      const program =
        programRel !== null && !programRel.startsWith('..') && !p.isAbsolute(programRel)
          ? p.join(source.worktreePath, programRel)
          : config.program;
      return { ...config, folder, program };
    });
    const mappedGroup: Group = {
      ...group,
      folders: configs.map((c, i) => ({ id: 'verify-' + i, path: c.folder })),
      primaryFolderId: 'verify-0',
    };
    const specs: LaunchSpec[] = [];
    for (const config of configs) {
      const result = await this.specOf(config, mappedGroup, choice);
      if ('needsConfirm' in result) return result;
      specs.push(result.spec);
    }
    const control = { cancelled: false, activeId: null as string | null };
    this.verificationRuns.set(verificationId, control);
    try {
      let started: RunStarted | undefined;
      for (const [index, config] of configs.entries()) {
        if (control.cancelled)
          throw new MelinnaError('INPUT_INVALID', { userMessage: 'Verificação cancelada.' });
        const spec = specs[index];
        if (!spec) throw stale();
        assertWithinLimit(this.ctx.model.liveCount(), 1);
        const commandTask = this.createTask({ ...config, name: 'Verificar: ' + config.name }, mappedGroup);
        const command = this.executionCommand(config, spec);
        command.commandId = 'workflow-verify-' + verificationId + '-' + index;
        const exec = createCommandExecutionRecord(this.ctx, commandTask, command);
        control.activeId = exec.id;
        await prepareExecution(this.ctx, commandTask, exec, new Set());
        await startExecution(this.ctx, this.ctx.model.execution(exec.id) ?? exec, size, {});
        started = { taskId: commandTask.id, execId: exec.id, reused: false };
        if (index < configs.length - 1) {
          const ended = await this.waitForEnd(exec.id);
          if (ended.cancelled || ended.exitCode !== 0)
            throw beforeLaunchFailed(config.name, ended.cancelled ? 'cancelled' : 'exit', ended.exitCode);
        }
      }
      if (!started) throw stale();
      return started;
    } finally {
      this.verificationRuns.delete(verificationId);
    }
  }
  async cancelVerification(verificationId: string): Promise<void> {
    const running = this.verificationRuns.get(verificationId);
    if (!running) return;
    running.cancelled = true;
    if (running.activeId) await this.stopAndWait(running.activeId);
  }

  /** Para (se viva) e relança a execução de comando, com a configuração resolvida de novo. */
  async rerun(execId: string, size: { cols: number; rows: number }): Promise<void> {
    const exec = this.ctx.model.execution(execId);
    const groupId = exec ? this.ctx.model.task(exec.taskId)?.groupId : undefined;
    if (!exec?.command || !groupId) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Esta execução não é um comando.' });
    }
    const configId = exec.command.commandId;
    await this.ctx.mutex.run(this.key(groupId, configId), async () => {
      // Resolve antes de parar: configuração sumida ou programa ausente não derruba o que está rodando.
      const group = this.ctx.model.group(groupId);
      const config = group?.runConfigs?.find((c) => c.id === configId);
      if (!group || !config) throw new MelinnaError('RUN_CONFIG_MISSING');
      const result = await this.specOf(config, group, undefined);
      if ('needsConfirm' in result) {
        throw new MelinnaError('INPUT_INVALID', {
          userMessage:
            'O wrapper do projeto não tem permissão de execução; rode pelo seletor para escolher como seguir.',
        });
      }
      await this.stopAndWait(execId);
      this.ctx.update(execId, { command: this.executionCommand(config, result.spec) });
      await this.deps.executions.relaunch(execId, size);
      this.logStarted(config, 0);
    });
  }

  async saveConfig(groupId: string, input: RunConfigInput): Promise<RunConfigView> {
    const config = await saveConfig(this.ctx.model, groupId, input, this.detectDeps);
    this.ctx.log.info('run.config.save', {
      groupId,
      configId: config.id,
      tool: config.tool,
      envCount: config.env.length,
      created: input.id === undefined,
    });
    const group = this.requireGroup(groupId);
    return this.view(config, group, group.runConfigs ?? []);
  }

  removeConfig(groupId: string, configId: string): Promise<void> {
    return this.ctx.mutex.run(this.key(groupId, configId), async () => {
      removeConfig(this.ctx.model, groupId, configId, (id) => this.liveCount(groupId, id));
      this.ctx.log.info('run.config.remove', { groupId });
    });
  }

  reorder(groupId: string, items: readonly RunReorderItem[]): Promise<void> {
    reorder(this.ctx.model, groupId, items);
    return Promise.resolve();
  }

  private key(groupId: string, configId: string): string {
    return `run:${groupId}:${configId}`;
  }

  private requireGroup(groupId: string): Group {
    const group = this.ctx.model.group(groupId);
    if (!group) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Workspace não encontrado.' });
    return group;
  }

  private view(config: RunConfig, group: Group, all: readonly RunConfig[]): Promise<RunConfigView> {
    return toView(config, group, all, this.detectDeps, this.liveCount(group.id, config.id));
  }

  /** As execuções dessa configuração neste workspace, da mais antiga à mais nova. */
  private instancesOf(groupId: string, configId: string): Execution[] {
    const { model } = this.ctx;
    return model.raw.executions.filter(
      (e) => e.command?.commandId === configId && model.task(e.taskId)?.groupId === groupId,
    );
  }

  private liveCount(groupId: string, configId: string): number {
    return this.instancesOf(groupId, configId).filter((e) => isLive(e.status)).length;
  }

  private executionCommand(config: RunConfig, spec: LaunchSpec): ExecutionCommand {
    return {
      commandId: config.id,
      label: config.name,
      file: spec.file,
      args: spec.args,
      tool: config.tool,
      ...(config.env.length > 0 ? { env: config.env.map((v) => ({ ...v })) } : {}),
      ...(config.runtimeOptions !== '' ? { runtimeOptions: config.runtimeOptions } : {}),
    };
  }

  /** Lança uma etapa de "antes de lançar" e espera o fim; só o código 0 deixa a cadeia seguir. */
  private async runStep(
    step: RunConfig,
    group: Group,
    spec: LaunchSpec,
    size: { cols: number; rows: number },
  ): Promise<void> {
    const { execId } = await this.ctx.mutex.run(this.key(group.id, step.id), async () => {
      const live = this.instancesOf(group.id, step.id).some((e) => isLive(e.status));
      if (live && !step.allowParallel) throw beforeLaunchFailed(step.name, 'already-running');
      return this.launch(step, group, spec, size, 0);
    });
    const end = await this.waitForEnd(execId);
    if (end.cancelled) throw beforeLaunchFailed(step.name, 'cancelled');
    if (end.exitCode !== 0) throw beforeLaunchFailed(step.name, 'exit', end.exitCode);
  }

  /**
   * Cria a execução da configuração ou relança a anterior (mesmo painel). Com várias instâncias, sempre cria
   * outra.
   */
  private async launch(
    config: RunConfig,
    group: Group,
    spec: LaunchSpec,
    size: { cols: number; rows: number },
    steps: number,
  ): Promise<RunStarted> {
    const execCommand = this.executionCommand(config, spec);
    const prior = config.allowParallel ? undefined : this.instancesOf(group.id, config.id).at(-1);
    if (prior) {
      this.ctx.update(prior.id, { command: execCommand });
      await this.deps.executions.relaunch(prior.id, size);
      this.logStarted(config, steps);
      return { taskId: prior.taskId, execId: prior.id, reused: false };
    }
    assertWithinLimit(this.ctx.model.liveCount(), 1);
    const task = this.createTask(config, group);
    const exec = createCommandExecutionRecord(this.ctx, task, execCommand);
    await prepareExecution(this.ctx, task, exec, new Set());
    await startExecution(this.ctx, this.ctx.model.execution(exec.id) ?? exec, size, {});
    this.logStarted(config, steps);
    return { taskId: task.id, execId: exec.id, reused: false };
  }

  /**
   * Espera o término da execução: o código de saída, ou cancelada quando alguém pediu para parar, ela morreu
   * por sinal ou o registro foi removido.
   */
  private waitForEnd(execId: string): Promise<{ exitCode: number | null; cancelled: boolean }> {
    let stopped = false;
    const settled = (): { exitCode: number | null; cancelled: boolean } | null => {
      const exec = this.ctx.model.execution(execId);
      if (!exec) return { exitCode: null, cancelled: true };
      if (isLive(exec.status)) return null;
      return {
        exitCode: exec.exitCode,
        cancelled: stopped || exec.exitCode === null || exec.signal !== null,
      };
    };
    return new Promise((resolve) => {
      const offs: (() => void)[] = [];
      const finish = (value: { exitCode: number | null; cancelled: boolean }) => {
        for (const off of offs) off();
        resolve(value);
      };
      offs.push(
        this.deps.executions.onStopRequested((id) => {
          if (id === execId) stopped = true;
        }),
        this.deps.executions.onEnded((id) => {
          if (id !== execId) return;
          finish(settled() ?? { exitCode: null, cancelled: true });
        }),
      );
      const now = settled();
      if (now) finish(now);
    });
  }

  private createTask(config: RunConfig, group: Group): Task {
    const title = config.name.slice(0, TASK_TITLE_MAX);
    const task: Task = {
      id: newId(),
      groupId: group.id,
      title,
      prompt: '',
      repoPath: config.folder,
      repoId: repoIdOf(config.folder, this.ctx.os),
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

  /** Programa e argumentos da configuração, ou o pedido de escolha quando o wrapper não tem permissão. */
  private async specOf(
    config: RunConfig,
    group: Group,
    choice: RunChoice | undefined,
  ): Promise<SpecOrConfirm> {
    if (folderOfWorkspace(group, config.folder, this.detectDeps) === null) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'A pasta precisa ser do workspace.' });
    }
    const { program, args } = await launchPlan(config, this.detectDeps);
    const { platform } = this.deps;
    let resolved;
    try {
      resolved = await resolveProgram(program, platform, this.ctx.fs);
    } catch (err) {
      if (
        err instanceof MelinnaError &&
        err.code === 'INPUT_INVALID' &&
        err.userMessage === BATCH_PROGRAM_MESSAGE
      ) {
        throw new MelinnaError('RUN_UNSAFE_TARGET', {
          userMessage: BATCH_PROGRAM_MESSAGE,
          details: { program },
        });
      }
      throw err;
    }
    const systemTool = this.wrapperTool(program);
    const needsChoice = systemTool !== null && !resolved.executable;
    if (needsChoice) {
      if (choice === undefined) return { needsConfirm: 'wrapper-sh', wrapper: program };
      if (choice === 'wrapper-sh') {
        const sh = await resolveProgram('sh', platform, this.ctx.fs);
        return { spec: { file: sh.file, args: [...sh.prefixArgs, program, ...args] }, usedChoice: true };
      }
      const tool = await resolveProgram(systemTool, platform, this.ctx.fs);
      return { spec: { file: tool.file, args: [...tool.prefixArgs, ...args] }, usedChoice: true };
    }
    if (!resolved.executable) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: `${program} não tem permissão de execução.` });
    }
    return { spec: { file: resolved.file, args: [...resolved.prefixArgs, ...args] }, usedChoice: false };
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

  private logStarted(config: RunConfig, steps: number): void {
    this.ctx.log.info('run.start', {
      configId: config.id,
      tool: config.tool,
      envNames: envNames(config).join(','),
      parallel: config.allowParallel,
      beforeLaunch: steps,
    });
  }
}
