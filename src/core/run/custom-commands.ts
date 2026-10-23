import { MelinnaError } from '../errors';
import { newId } from '../ids';
import { normalizeRepoPath } from '../paths';
import type { Group } from '../persistence/state-schema';
import type { OsName } from '../ports/platform';
import type { WorkspaceModel } from '../workspace/workspace-model';
import type { DetectDeps } from './detect';
import { RUN_LIMITS } from './limits';
import { checkProgram } from './resolve-program';
import type { RunCommand, RunCommandInput, StoredCommand } from './types';

export type CustomInput = RunCommandInput;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function invalid(userMessage: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage });
}

function stale(): MelinnaError {
  return new MelinnaError('COMMAND_STALE');
}

/** Pastas do workspace como caminhos; grupo antigo sem lista de pastas vale pelo caminho do repositório. */
export function workspaceFolders(group: Group): string[] {
  if (group.folders && group.folders.length > 0) return group.folders.map((f) => f.path);
  return group.repoPath ? [group.repoPath] : [];
}

function sameFolder(a: string, b: string, os: OsName): boolean {
  return normalizeRepoPath(a, os) === normalizeRepoPath(b, os);
}

/** A pasta (normalizada como o workspace a guarda) ou `null` se ela não é do workspace. */
function folderOfWorkspace(group: Group, folder: string, os: OsName): string | null {
  return workspaceFolders(group).find((f) => sameFolder(f, folder, os)) ?? null;
}

function requireGroup(model: WorkspaceModel, groupId: string): Group {
  const group = model.group(groupId);
  if (!group) throw invalid('Workspace não encontrado.');
  return group;
}

function validate(input: CustomInput, group: Group, os: OsName): Omit<StoredCommand, 'id' | 'source'> {
  const label = input.label.trim();
  if (label.length < 1 || label.length > RUN_LIMITS.label || /[\r\n]/.test(label)) {
    throw invalid(`O nome deve ter de 1 a ${RUN_LIMITS.label} caracteres, sem quebra de linha.`);
  }
  if (input.program.length < 1 || input.program.length > RUN_LIMITS.program || CONTROL.test(input.program)) {
    throw invalid('Informe o programa (sem caracteres de controle).');
  }
  if (input.args.length > RUN_LIMITS.args) {
    throw invalid(`Use no máximo ${RUN_LIMITS.args} argumentos.`);
  }
  for (const arg of input.args) {
    if (arg.length > RUN_LIMITS.arg || CONTROL.test(arg)) {
      throw invalid(`Cada argumento deve ter até ${RUN_LIMITS.arg} caracteres, sem caracteres de controle.`);
    }
  }
  const folder = folderOfWorkspace(group, input.folder, os);
  if (folder === null) throw invalid('A pasta precisa ser do workspace.');
  return { label, program: input.program, args: [...input.args], folder };
}

/**
 * Cria ou edita uma configuração personalizada do workspace. O nome é único entre as personalizadas
 * do workspace, sem diferenciar maiúsculas; editar um id que não existe mais é `COMMAND_STALE`.
 */
export function saveCustomCommand(
  model: WorkspaceModel,
  groupId: string,
  input: CustomInput,
  os: OsName,
): { stored: StoredCommand; created: boolean } {
  const group = requireGroup(model, groupId);
  const existing = group.commands ?? [];
  if (input.id !== undefined && !existing.some((c) => c.id === input.id)) throw stale();
  const fields = validate(input, group, os);
  const key = fields.label.toLowerCase();
  if (existing.some((c) => c.id !== input.id && c.label.toLowerCase() === key)) {
    throw invalid('Já existe uma configuração com esse nome.');
  }
  const stored: StoredCommand = { id: input.id ?? newId(), source: 'custom', ...fields };
  model.mutate((s) => {
    const g = s.groups.find((x) => x.id === groupId);
    if (!g) return;
    const list = g.commands ?? [];
    g.commands =
      input.id === undefined ? [...list, stored] : list.map((c) => (c.id === input.id ? stored : c));
  });
  return { stored, created: input.id === undefined };
}

export function removeCustomCommand(model: WorkspaceModel, groupId: string, commandId: string): void {
  const group = requireGroup(model, groupId);
  if (!(group.commands ?? []).some((c) => c.id === commandId)) throw stale();
  model.mutate((s) => {
    const g = s.groups.find((x) => x.id === groupId);
    if (g) g.commands = (g.commands ?? []).filter((c) => c.id !== commandId);
  });
}

/** Monta a configuração com a disponibilidade calculada agora (programa e pasta). */
export async function describeCustom(
  stored: StoredCommand,
  group: Group,
  deps: DetectDeps,
): Promise<RunCommand> {
  const base = {
    id: stored.id,
    groupId: group.id,
    source: 'custom' as const,
    tool: 'custom' as const,
    label: stored.label,
    program: stored.program,
    args: stored.args,
    folder: stored.folder,
  };
  if (folderOfWorkspace(group, stored.folder, deps.platform.os) === null) {
    return { ...base, available: false, unavailableReason: 'folder-outside', searched: '' };
  }
  const check = await checkProgram(stored.program, deps.platform, deps.fs);
  return {
    ...base,
    available: check.available,
    unavailableReason: check.available ? null : 'not-found',
    searched: check.searched,
  };
}
