import { isMelinnaError, MelinnaError } from '../errors';
import { isLive } from '../execution/state-machine';
import { pathModule } from '../paths';
import type { Execution, Task } from '../persistence/state-schema';
import type { Cancel, Clock } from '../ports/clock';
import type { FileSystem } from '../ports/file-system';
import type { Logger } from '../ports/logger';
import type { OsName } from '../ports/platform';
import type { LaunchedSession, LaunchSessionInput } from '../workspace/session-launcher';

/** Pasta dos pedidos, dentro da pasta de trabalho do coordenador (o agente consegue gravar nela). */
export const SPAWN_DIR = ['.melinna', 'spawn'] as const;
export const COORDINATOR_POLL_MS = 2_000;
/** Workers que um coordenador pode abrir ao todo; as vagas de execuções vivas valem por cima disso. */
export const COORDINATOR_MAX_WORKERS = 8;
export const REQUEST_MAX_BYTES = 200_000;
const PROMPT_MAX = 100_000;
const TITLE_MAX = 80;

const REQUEST_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.json$/;
const RESULT_SUFFIX = '.result.json';
const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** Caracteres de controle exceto quebra de linha e tabulação: o enunciado vai a um terminal. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;

export interface WorkerRequest {
  agent: string;
  prompt: string;
  title?: string;
  isolation: 'worktree' | 'direct';
}

/** O que o app grava ao lado do pedido, em `<pedido>.result.json`. */
export type WorkerResult =
  | {
      status: 'launched';
      at: string;
      taskId: string;
      execId: string;
      /** Estado da execução do worker; o app regrava o arquivo quando muda. */
      worker: Execution['status'];
      /** Pasta onde o worker trabalha e a branch dele (vazia fora do git). */
      folder: string;
      branch: string;
    }
  | { status: 'refused'; at: string; reason: string };

export interface CoordinatorDeps {
  fs: FileSystem;
  os: OsName;
  clock: Clock;
  log: Logger;
  model: {
    task(id: string): Task | undefined;
    execution(id: string): Execution | undefined;
    executionsOf(taskId: string): Execution[];
    readonly raw: { readonly tasks: readonly Task[] };
  };
  launch: (input: LaunchSessionInput) => Promise<LaunchedSession>;
}

interface Tracked {
  execId: string;
  worker: Execution['status'];
  result: Extract<WorkerResult, { status: 'launched' }>;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valida um pedido escrito pelo agente; o texto do erro volta para ele no arquivo de resultado. */
export function parseWorkerRequest(raw: string): WorkerRequest {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new MelinnaError('INPUT_INVALID', { userMessage: 'O pedido não é um JSON válido.' });
  }
  const bad = (message: string) => new MelinnaError('INPUT_INVALID', { userMessage: message });
  if (!isObj(json)) throw bad('O pedido deve ser um objeto JSON.');
  if (typeof json.agent !== 'string' || !AGENT_ID.test(json.agent)) throw bad('Campo "agent" inválido.');
  if (typeof json.prompt !== 'string' || json.prompt.trim() === '' || json.prompt.length > PROMPT_MAX) {
    throw bad('Campo "prompt" inválido: texto de 1 a 100.000 caracteres.');
  }
  const prompt = json.prompt.replace(/\r\n/g, '\n');
  if (CONTROL.test(prompt)) throw bad('O campo "prompt" contém caracteres de controle.');
  const request: WorkerRequest = { agent: json.agent, prompt, isolation: 'worktree' };
  if (json.title !== undefined) {
    if (typeof json.title !== 'string' || json.title.trim() === '' || json.title.length > TITLE_MAX) {
      throw bad('Campo "title" inválido: texto de até 80 caracteres.');
    }
    if (CONTROL.test(json.title) || /[\n\t]/.test(json.title)) throw bad('Campo "title" inválido.');
    request.title = json.title.trim();
  }
  if (json.isolation !== undefined) {
    if (json.isolation !== 'worktree' && json.isolation !== 'direct')
      throw bad('Campo "isolation" inválido.');
    request.isolation = json.isolation;
  }
  return request;
}

/** Instruções que vão antes do enunciado do coordenador: como pedir workers e ler o resultado. */
export const SPAWN_COMMAND = String.raw`const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
try {
  const raw = fs.readFileSync(0, 'utf8');
  if (Buffer.byteLength(raw) > 200000) throw new Error('Pedido grande demais.');
  const request = JSON.parse(raw);
  if (!request || typeof request.agent !== 'string' || typeof request.prompt !== 'string') {
    throw new Error('Informe agent e prompt.');
  }
  const name = randomUUID();
  const pending = path.join(__dirname, name + '.pending');
  fs.writeFileSync(pending, JSON.stringify(request), { flag: 'wx' });
  fs.renameSync(pending, path.join(__dirname, name + '.json'));
  process.stdout.write(path.join(__dirname, name + '.result.json') + '
');
} catch (error) {
  process.stderr.write(String(error.message) + '
');
  process.exitCode = 1;
}
`;

export function coordinatorInstructions(dir: string): string {
  return [
    'Você é o coordenador desta tarefa no Melinna e pode abrir outras sessões de agente (workers) para dividir o trabalho.',
    `Para abrir um worker, execute o comando do app: node "${dir}/spawn-worker.cjs" < pedido.json. O arquivo pedido.json deve conter:`,
    '{"agent": "claude", "prompt": "o que o worker deve fazer, com todo o contexto de que ele precisa", "title": "nome curto"}',
    'O campo "agent" é o id de um agente do catálogo do app (por exemplo claude ou codex). Cada worker trabalha num git worktree próprio, em uma branch nova a partir do HEAD desta pasta; use "isolation": "direct" só se ele precisar trabalhar nesta mesma pasta.',
    `Em poucos segundos o app grava ao lado o arquivo <nome>.result.json: "status": "launched" traz a pasta ("folder") e a branch do worker, e o campo "worker" acompanha o estado dele (running, idle, exited); "status": "refused" traz o motivo em "reason". O limite é de ${COORDINATOR_MAX_WORKERS} workers.`,
    'O worker não vê esta conversa: escreva enunciados completos. Para conferir o que um worker fez, leia a pasta dele ou use git na branch dele. Não apague os arquivos desta pasta de pedidos.',
  ].join('\n');
}

/**
 * Coordenador: uma sessão marcada como coordenadora pede workers gravando arquivos JSON numa pasta de
 * pedidos dentro da própria pasta de trabalho. O app confere a pasta de tempos em tempos, lança cada
 * pedido na mesma pasta da tarefa (nunca em outra) e grava o resultado ao lado. Só vale enquanto o
 * coordenador tem uma execução viva.
 */
export class CoordinatorService {
  /** Tarefas coordenadoras ativas e os workers lançados por cada uma, por nome do pedido. */
  private readonly active = new Map<string, Map<string, Tracked>>();
  private readonly inFlight = new Set<string>();
  private cancel: Cancel | null = null;
  private started = false;

  constructor(private readonly deps: CoordinatorDeps) {}

  private get p(): ReturnType<typeof pathModule> {
    return pathModule(this.deps.os);
  }

  dirFor(task: Pick<Task, 'id' | 'repoPath'>): string {
    return this.p.join(task.repoPath, ...SPAWN_DIR, task.id);
  }

  /**
   * Marca a tarefa como coordenadora: cria a pasta de pedidos, tira `.melinna/` do `git status` do
   * repositório e devolve o enunciado com as instruções na frente.
   */
  async enable(task: Task): Promise<string> {
    const dir = this.dirFor(task);
    await this.deps.fs.mkdir(dir, { recursive: true });
    await this.deps.fs.writeFile(this.p.join(dir, 'spawn-worker.cjs'), SPAWN_COMMAND);
    await this.excludeFromGit(task.repoPath);
    this.active.set(task.id, new Map());
    this.deps.log.info('coordinator.enabled', { taskId: task.id });
    const instructions = coordinatorInstructions(dir);
    return task.prompt.trim() === ''
      ? instructions
      : `${instructions}\n\nObjetivo do usuário:\n${task.prompt}`;
  }

  isCoordinator(taskId: string): boolean {
    return this.active.has(taskId);
  }

  /** Retoma as tarefas coordenadoras que já tinham pasta de pedidos e começa a conferir as pastas. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    for (const task of this.deps.model.raw.tasks) {
      if (this.active.has(task.id)) continue;
      if (await this.deps.fs.exists(this.dirFor(task))) {
        await this.deps.fs.writeFile(this.p.join(this.dirFor(task), 'spawn-worker.cjs'), SPAWN_COMMAND);
        this.active.set(task.id, await this.readTracked(task));
      }
    }
    this.arm();
  }

  stop(): void {
    this.started = false;
    this.cancel?.();
    this.cancel = null;
  }

  /** Uma passada por todas as pastas de pedidos; exposta para os testes e chamada pelo temporizador. */
  async poll(): Promise<void> {
    for (const taskId of [...this.active.keys()]) {
      const task = this.deps.model.task(taskId);
      if (!task) {
        this.active.delete(taskId);
        continue;
      }
      try {
        await this.pollTask(task);
      } catch (err) {
        this.deps.log.error('coordinator.poll_failed', { err, taskId });
      }
    }
  }

  private arm(): void {
    if (!this.started) return;
    this.cancel = this.deps.clock.setTimeout(() => {
      void this.poll().finally(() => this.arm());
    }, COORDINATOR_POLL_MS);
  }

  private async pollTask(task: Task): Promise<void> {
    const { fs, model } = this.deps;
    const dir = this.dirFor(task);
    const tracked = this.active.get(task.id);
    if (!tracked) return;
    await this.refreshWorkers(dir, tracked);
    // Sem execução viva o coordenador não está pedindo nada: pedidos antigos não disparam depois.
    if (!model.executionsOf(task.id).some((e) => isLive(e.status))) return;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    const present = new Set(names);
    for (const name of names.sort()) {
      if (!REQUEST_FILE.test(name) || name.endsWith(RESULT_SUFFIX)) continue;
      const resultName = `${name.slice(0, -'.json'.length)}${RESULT_SUFFIX}`;
      const key = `${task.id}/${name}`;
      if (present.has(resultName) || this.inFlight.has(key)) continue;
      this.inFlight.add(key);
      try {
        const result = await this.handle(task, this.p.join(dir, name), tracked.size);
        await fs.writeFile(this.p.join(dir, resultName), JSON.stringify(result, null, 2));
        if (result.status === 'launched') {
          tracked.set(resultName, { execId: result.execId, worker: result.worker, result });
        }
      } finally {
        this.inFlight.delete(key);
      }
    }
  }

  private async handle(task: Task, file: string, launched: number): Promise<WorkerResult> {
    const { fs, clock, log, model, launch } = this.deps;
    const at = clock.now().toISOString();
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile || stat.isSymbolicLink) {
        throw new MelinnaError('INPUT_INVALID', { userMessage: 'O pedido deve ser um arquivo comum.' });
      }
      if (stat.size > REQUEST_MAX_BYTES) {
        throw new MelinnaError('INPUT_INVALID', { userMessage: 'O pedido é grande demais.' });
      }
      if (launched >= COORDINATOR_MAX_WORKERS) {
        throw new MelinnaError('LIMIT_REACHED', {
          userMessage: `Este coordenador já abriu o limite de ${COORDINATOR_MAX_WORKERS} workers.`,
        });
      }
      const request = parseWorkerRequest(new TextDecoder().decode(await fs.readFile(file)));
      const session = await launch({
        folder: task.repoPath,
        agentId: request.agent,
        prompt: request.prompt,
        title: request.title ?? `Worker de ${task.title}`.slice(0, TITLE_MAX),
        isolation: request.isolation,
      });
      const exec = model.execution(session.execId);
      log.info('coordinator.worker_launched', { taskId: task.id, workerTaskId: session.taskId });
      return {
        status: 'launched',
        at,
        taskId: session.taskId,
        execId: session.execId,
        worker: exec?.status ?? 'starting',
        folder: exec?.worktreePath ?? task.repoPath,
        branch: exec?.branch ?? '',
      };
    } catch (err) {
      const reason = isMelinnaError(err) ? err.userMessage : 'Erro interno ao abrir o worker.';
      if (!isMelinnaError(err)) log.error('coordinator.worker_failed', { err, taskId: task.id });
      else log.warn('coordinator.worker_refused', { taskId: task.id, code: err.code });
      return { status: 'refused', at, reason };
    }
  }

  /** Regrava o resultado dos workers cujo estado mudou desde a última passada. */
  private async refreshWorkers(dir: string, tracked: Map<string, Tracked>): Promise<void> {
    for (const [resultName, entry] of tracked) {
      const status = this.deps.model.execution(entry.execId)?.status;
      if (status === undefined || status === entry.worker) continue;
      entry.worker = status;
      entry.result = { ...entry.result, worker: status };
      try {
        await this.deps.fs.writeFile(this.p.join(dir, resultName), JSON.stringify(entry.result, null, 2));
      } catch (err) {
        this.deps.log.warn('coordinator.result_write_failed', {
          reason: err instanceof Error ? err.message : '',
        });
      }
    }
  }

  /** Reconstrói, depois de reabrir o app, os workers já lançados a partir dos arquivos de resultado. */
  private async readTracked(task: Task): Promise<Map<string, Tracked>> {
    const tracked = new Map<string, Tracked>();
    const dir = this.dirFor(task);
    let names: string[] = [];
    try {
      names = await this.deps.fs.readdir(dir);
    } catch {
      return tracked;
    }
    for (const name of names) {
      if (!name.endsWith(RESULT_SUFFIX)) continue;
      try {
        const json: unknown = JSON.parse(
          new TextDecoder().decode(await this.deps.fs.readFile(this.p.join(dir, name))),
        );
        if (isObj(json) && json.status === 'launched' && typeof json.execId === 'string') {
          const result = json as Extract<WorkerResult, { status: 'launched' }>;
          tracked.set(name, { execId: result.execId, worker: result.worker, result });
        }
      } catch {
        // resultado ilegível: o pedido já foi tratado, só não é mais acompanhado
      }
    }
    return tracked;
  }

  /** `.melinna/` fica fora do `git status` por `.git/info/exclude`, sem tocar em arquivo versionado. */
  private async excludeFromGit(repoPath: string): Promise<void> {
    const { fs, log } = this.deps;
    const gitDir = this.p.join(repoPath, '.git');
    try {
      if (!(await fs.stat(gitDir)).isDirectory) return;
      const info = this.p.join(gitDir, 'info');
      const file = this.p.join(info, 'exclude');
      let current = '';
      try {
        current = new TextDecoder().decode(await fs.readFile(file));
      } catch {
        await fs.mkdir(info, { recursive: true });
      }
      if (current.split(/\r?\n/).some((line) => line.trim() === '.melinna/')) return;
      const prefix = current === '' || current.endsWith('\n') ? '' : '\n';
      await fs.writeFile(file, `${current}${prefix}.melinna/\n`);
    } catch (err) {
      // Não é repositório git, ou o arquivo não pôde ser escrito: a pasta de pedidos só aparece no status.
      log.debug('coordinator.exclude_skipped', { reason: err instanceof Error ? err.message : '' });
    }
  }
}
