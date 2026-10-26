import { MelinnaError } from '../errors';
import { newId } from '../ids';
import { normalizeRepoPath, pathModule } from '../paths';
import type { Group } from '../persistence/state-schema';
import type { WorkspaceModel } from '../workspace/workspace-model';
import { tokenizeArgs } from '../../shared/tokenize-args';
import { chainOf } from './before-launch';
import { detectFolder, type DetectDeps } from './detect';
import { RUN_LIMITS } from './limits';
import { resolveProgram } from './resolve-program';
import { runtimeVariable } from './run-env';
import {
  RUN_CONFIG_TOOLS,
  type RunConfig,
  type RunConfigInput,
  type RunConfigTool,
  type RunConfigUnavailableReason,
  type RunConfigView,
  type RunEnvVar,
  type RunReorderItem,
} from './types';

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SCRIPT_TOOLS: readonly RunConfigTool[] = ['npm', 'pnpm', 'yarn'];
const OBJECTIVE_TOOLS: readonly RunConfigTool[] = ['maven', 'gradle'];

function invalid(field: string, userMessage: string, reason = 'invalid'): MelinnaError {
  return new MelinnaError('RUN_CONFIG_INVALID', { userMessage, details: { field, reason } });
}

function missing(): MelinnaError {
  return new MelinnaError('RUN_CONFIG_MISSING');
}

/** Pastas do workspace como caminhos; grupo antigo sem lista de pastas vale pelo caminho do repositório. */
export function workspaceFolders(group: Group): string[] {
  if (group.folders && group.folders.length > 0) return group.folders.map((f) => f.path);
  return group.repoPath ? [group.repoPath] : [];
}

/** A pasta (como o workspace a guarda) ou `null` se ela não é do workspace. */
export function folderOfWorkspace(group: Group, folder: string, deps: DetectDeps): string | null {
  const os = deps.platform.os;
  const wanted = normalizeRepoPath(folder, os);
  return workspaceFolders(group).find((f) => normalizeRepoPath(f, os) === wanted) ?? null;
}

function requireGroup(model: WorkspaceModel, groupId: string): Group {
  const group = model.group(groupId);
  if (!group) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Workspace não encontrado.' });
  return group;
}

async function fileExists(deps: DetectDeps, path: string): Promise<boolean> {
  return deps.fs
    .stat(path)
    .then((s) => s.isFile)
    .catch(() => false);
}

/**
 * O programa que o núcleo usa em cada ferramenta: o wrapper do projeto (`mvnw`/`gradlew`) quando existe e
 * a ferramenta do sistema senão — no Windows sempre a do sistema, porque os lotes não são executados.
 */
export async function deriveProgram(tool: RunConfigTool, folder: string, deps: DetectDeps): Promise<string> {
  switch (tool) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return tool;
    case 'maven':
    case 'gradle': {
      const system = tool === 'maven' ? 'mvn' : 'gradle';
      if (deps.platform.os === 'win32') return system;
      const wrapper = pathModule(deps.platform.os).join(folder, tool === 'maven' ? 'mvnw' : 'gradlew');
      return (await fileExists(deps, wrapper)) ? wrapper : system;
    }
    case 'compose': {
      const modern = await resolveProgram('docker', deps.platform, deps.fs).then(
        () => true,
        () => false,
      );
      if (modern) return 'docker';
      const legacy = await resolveProgram('docker-compose', deps.platform, deps.fs).then(
        () => true,
        () => false,
      );
      return legacy ? 'docker-compose' : 'docker';
    }
    default:
      return '';
  }
}

/** O programa e o vetor de argumentos que o núcleo lança para a configuração, sem shell. */
export async function launchPlan(
  config: RunConfig,
  deps: DetectDeps,
): Promise<{ program: string; args: string[] }> {
  if (config.tool === 'program') return { program: config.program, args: [...config.args] };
  const program = await deriveProgram(config.tool, config.folder, deps);
  switch (config.tool) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
      return { program, args: ['run', config.script ?? '', ...config.args] };
    case 'maven':
    case 'gradle':
      return { program, args: [...tokenizeArgs(config.script ?? ''), ...config.args] };
    default:
      return { program, args: program === 'docker-compose' ? [...config.args] : ['compose', ...config.args] };
  }
}

function validateName(input: RunConfigInput, others: readonly RunConfig[]): string {
  const name = input.name.trim();
  if (name.length < 1 || name.length > RUN_LIMITS.label || /[\r\n]/.test(name)) {
    throw invalid('name', `O nome deve ter de 1 a ${RUN_LIMITS.label} caracteres, sem quebra de linha.`);
  }
  const key = name.toLowerCase();
  if (others.some((c) => c.name.toLowerCase() === key)) {
    throw invalid('name', 'Já existe uma configuração com esse nome.', 'duplicate');
  }
  return name;
}

function validateArgs(args: readonly string[]): string[] {
  if (args.length > RUN_LIMITS.args) {
    throw invalid('args', `Use no máximo ${RUN_LIMITS.args} argumentos.`);
  }
  for (const arg of args) {
    if (arg.length > RUN_LIMITS.arg || CONTROL.test(arg)) {
      throw invalid(
        'args',
        `Cada argumento deve ter até ${RUN_LIMITS.arg} caracteres, sem caracteres de controle.`,
      );
    }
  }
  return [...args];
}

function validateEnv(env: readonly RunEnvVar[]): RunEnvVar[] {
  if (env.length > RUN_LIMITS.envPairs) {
    throw invalid('env', `Use no máximo ${RUN_LIMITS.envPairs} variáveis de ambiente.`);
  }
  const seen = new Set<string>();
  for (const { name, value } of env) {
    if (!ENV_NAME.test(name)) {
      throw invalid(
        'env',
        `Nome de variável inválido: "${name}". Use letras, números e _, sem começar por número.`,
      );
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw invalid('env', `A variável ${name} está repetida.`, 'duplicate');
    seen.add(key);
    if (value.length > RUN_LIMITS.envValue || value.includes('\0')) {
      throw invalid('env', `O valor de ${name} deve ter até ${RUN_LIMITS.envValue} caracteres.`);
    }
  }
  return env.map(({ name, value }) => ({ name, value }));
}

function validateFolderGroup(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > RUN_LIMITS.folderGroup || /[\r\n]/.test(trimmed)) {
    throw invalid('folderGroup', `O nome da pasta deve ter de 1 a ${RUN_LIMITS.folderGroup} caracteres.`);
  }
  return trimmed;
}

/** Nomes dos scripts de `package.json` detectados na pasta. */
async function detectedScripts(deps: DetectDeps, group: Group, folder: string): Promise<string[]> {
  const detected = await detectFolder(deps, group.id, folder);
  return detected.commands.filter((c) => c.source === 'npm').map((c) => c.label);
}

async function validateScript(
  input: RunConfigInput,
  group: Group,
  folder: string,
  deps: DetectDeps,
): Promise<string | null> {
  if (SCRIPT_TOOLS.includes(input.tool)) {
    const script = (input.script ?? '').trim();
    if (script === '' || !(await detectedScripts(deps, group, folder)).includes(script)) {
      throw invalid('script', 'O script não existe no package.json da pasta.');
    }
    return script;
  }
  if (OBJECTIVE_TOOLS.includes(input.tool)) {
    const text = (input.script ?? '').trim();
    const label = input.tool === 'maven' ? 'um objetivo' : 'uma tarefa';
    if (text === '' || tokenizeArgs(text).length === 0) throw invalid('script', `Informe ${label}.`);
    if (text.length > RUN_LIMITS.script || CONTROL.test(text)) {
      throw invalid('script', `Use até ${RUN_LIMITS.script} caracteres, sem caracteres de controle.`);
    }
    return text;
  }
  return null;
}

function validateProgram(input: RunConfigInput): string {
  if (input.tool !== 'program') return '';
  if (input.program.length < 1 || input.program.length > RUN_LIMITS.program || CONTROL.test(input.program)) {
    throw invalid('program', 'Informe o programa (sem caracteres de controle).');
  }
  return input.program;
}

function validateRuntimeOptions(input: RunConfigInput): string {
  if (runtimeVariable(input.tool) === null) return '';
  const options = input.runtimeOptions.trim();
  if (options.length > RUN_LIMITS.runtimeOptions || CONTROL.test(options)) {
    throw invalid(
      'runtimeOptions',
      `Use até ${RUN_LIMITS.runtimeOptions} caracteres, sem caracteres de controle.`,
    );
  }
  return options;
}

/** Posição seguinte dentro do grupo (ferramenta + pasta de agrupamento). */
function nextOrder(list: readonly RunConfig[], tool: RunConfigTool, folderGroup: string | null): number {
  const inGroup = list.filter((c) => c.tool === tool && c.folderGroup === folderGroup);
  return inGroup.length === 0 ? 0 : Math.max(...inGroup.map((c) => c.order)) + 1;
}

/**
 * Cria ou edita uma configuração do workspace. Valida tudo antes de gravar: nome único (sem diferenciar
 * maiúsculas), pasta do workspace, script entre os detectados, variáveis, limites e "antes de lançar" sem
 * ciclo. O programa das ferramentas é sempre derivado aqui; o que vier do renderer é ignorado.
 */
export async function saveConfig(
  model: WorkspaceModel,
  groupId: string,
  input: RunConfigInput,
  deps: DetectDeps,
): Promise<RunConfig> {
  const group = requireGroup(model, groupId);
  const existing = group.runConfigs ?? [];
  const prior = input.id === undefined ? undefined : existing.find((c) => c.id === input.id);
  if (input.id !== undefined && prior === undefined) throw missing();
  const others = existing.filter((c) => c.id !== input.id);

  if (!RUN_CONFIG_TOOLS.includes(input.tool)) throw invalid('tool', 'Ferramenta desconhecida.');
  const name = validateName(input, others);
  const folder = folderOfWorkspace(group, input.folder, deps);
  if (folder === null) throw invalid('folder', 'A pasta precisa ser do workspace.');
  const script = await validateScript(input, group, folder, deps);
  const userProgram = validateProgram(input);
  const args = validateArgs(input.args);
  const runtimeOptions = validateRuntimeOptions(input);
  const env = validateEnv(input.env);
  const folderGroup = validateFolderGroup(input.folderGroup);
  const id = prior?.id ?? newId();
  if (
    input.beforeLaunch !== null &&
    input.beforeLaunch !== id &&
    !others.some((c) => c.id === input.beforeLaunch)
  ) {
    throw invalid('beforeLaunch', 'A etapa de "Antes de lançar" não existe neste workspace.', 'missing');
  }
  const program = input.tool === 'program' ? userProgram : await deriveProgram(input.tool, folder, deps);
  const sameGroup = prior !== undefined && prior.tool === input.tool && prior.folderGroup === folderGroup;
  const config: RunConfig = {
    id,
    name,
    tool: input.tool,
    folder,
    script,
    program,
    args,
    runtimeOptions,
    env,
    beforeLaunch: input.beforeLaunch,
    allowParallel: input.allowParallel,
    folderGroup,
    order: sameGroup ? prior.order : nextOrder(others, input.tool, folderGroup),
  };
  chainOf([...others, config], id);
  model.mutate((s) => {
    const g = s.groups.find((x) => x.id === groupId);
    if (!g) return;
    const list = g.runConfigs ?? [];
    g.runConfigs = prior === undefined ? [...list, config] : list.map((c) => (c.id === id ? config : c));
  });
  return config;
}

/** Remove a configuração; uma que tem instância viva (`running(id) > 0`) é recusada. */
export function removeConfig(
  model: WorkspaceModel,
  groupId: string,
  configId: string,
  running: (configId: string) => number,
): void {
  const group = requireGroup(model, groupId);
  if (!(group.runConfigs ?? []).some((c) => c.id === configId)) throw missing();
  if (running(configId) > 0) {
    throw new MelinnaError('RUN_CONFIG_RUNNING', { details: { configId } });
  }
  model.mutate((s) => {
    const g = s.groups.find((x) => x.id === groupId);
    if (g) g.runConfigs = (g.runConfigs ?? []).filter((c) => c.id !== configId);
  });
}

/** Grava a pasta de agrupamento e a posição das configurações listadas; as demais ficam como estão. */
export function reorder(model: WorkspaceModel, groupId: string, items: readonly RunReorderItem[]): void {
  const group = requireGroup(model, groupId);
  const existing = group.runConfigs ?? [];
  const folderGroups = new Map<string, string | null>();
  for (const item of items) {
    if (!existing.some((c) => c.id === item.id)) throw missing();
    if (!Number.isInteger(item.order) || item.order < 0) {
      throw invalid('order', 'Posição inválida.');
    }
    folderGroups.set(item.id, validateFolderGroup(item.folderGroup));
  }
  model.mutate((s) => {
    const g = s.groups.find((x) => x.id === groupId);
    if (!g) return;
    g.runConfigs = (g.runConfigs ?? []).map((c) => {
      const item = items.find((i) => i.id === c.id);
      return item === undefined
        ? c
        : { ...c, folderGroup: folderGroups.get(c.id) ?? null, order: item.order };
    });
  });
}

/** A configuração com o que se calcula agora: pasta, "antes de lançar", script e programa. */
export async function toView(
  config: RunConfig,
  group: Group,
  all: readonly RunConfig[],
  deps: DetectDeps,
  running: number,
): Promise<RunConfigView> {
  const view = (reason: RunConfigUnavailableReason | null, searched = ''): RunConfigView => ({
    ...config,
    groupId: group.id,
    available: reason === null,
    unavailableReason: reason,
    searched,
    running,
  });
  if (folderOfWorkspace(group, config.folder, deps) === null) return view('folder-missing');
  if (config.beforeLaunch !== null && !all.some((c) => c.id === config.beforeLaunch)) {
    return view('before-launch-missing');
  }
  if (
    SCRIPT_TOOLS.includes(config.tool) &&
    !(await detectedScripts(deps, group, config.folder)).includes(config.script ?? '')
  ) {
    return view('script-missing');
  }
  const { program } = await launchPlan(config, deps);
  try {
    await resolveProgram(program, deps.platform, deps.fs);
  } catch (err) {
    if (!(err instanceof MelinnaError)) throw err;
    return err.code === 'PROGRAM_NOT_FOUND'
      ? view('program-missing', program)
      : view('unsafe-target', program);
  }
  return view(null, program);
}
