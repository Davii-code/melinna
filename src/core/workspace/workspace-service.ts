import type { WorkspaceChange } from '../api-types';
import { MelinnaError } from '../errors';
import { slugify } from '../git/branch-name';
import type { GitRunner } from '../git/git-runner';
import { inspectRepo, repoRoot, type RepoInspection } from '../git/repo';
import { cleanResidue, type ResidueDeps } from '../git/residue';
import { newId } from '../ids';
import { pathModule, repoIdOf } from '../paths';
import type { Group, Isolation, Task } from '../persistence/state-schema';
import {
  addFolder,
  derivedRepo,
  extrasOf,
  normalizeFolders,
  primaryOf,
  removeFolder,
  setPrimary,
  type FolderSet,
} from './workspace-folders';
import type { Clock } from '../ports/clock';
import type { Unsubscribe } from '../ports/host-client';
import type { Logger } from '../ports/logger';
import type { WorkspaceModel, WorkspaceSnapshot } from './workspace-model';

export const PROMPT_MAX = 100_000;
export const GROUP_NAME_MAX = 80;
export const TASK_TITLE_MAX = 120;

export interface CreateTaskInput {
  groupId: string;
  repoPath: string;
  baseRef: string;
  prompt: string;
  title?: string;
  /** Padrão `worktree`; o app lança em `direct`. */
  isolation?: Isolation;
}

export interface WorkspaceServiceDeps {
  model: WorkspaceModel;
  git: GitRunner;
  clock: Clock;
  log: Logger;
  residue: ResidueDeps;
  /** Chamado depois que um workspace sai da lista (ex.: remover os prompts do escopo dele). */
  onGroupRemoved?: (groupId: string) => void;
}

export function validateGroupName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > GROUP_NAME_MAX || /[\r\n]/.test(trimmed)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `O nome do grupo deve ter de 1 a ${GROUP_NAME_MAX} caracteres, sem quebra de linha.`,
    });
  }
  return trimmed;
}

export function validateWorkspaceName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > GROUP_NAME_MAX || /[\r\n]/.test(trimmed)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `O nome do workspace deve ter de 1 a ${GROUP_NAME_MAX} caracteres, sem quebra de linha.`,
    });
  }
  return trimmed;
}

export function validateTaskTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > TASK_TITLE_MAX || /[\r\n]/.test(trimmed)) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `O título da tarefa deve ter de 1 a ${TASK_TITLE_MAX} caracteres, sem quebra de linha.`,
    });
  }
  return trimmed;
}

/** O enunciado é opcional (vazio = o agente abre sem instrução); só não pode ter `\0` nem passar do limite. */
export function validatePrompt(prompt: string): void {
  if (prompt.includes('\0')) throw new MelinnaError('PROMPT_INVALID');
  if (prompt.length > PROMPT_MAX) {
    throw new MelinnaError('INPUT_INVALID', {
      userMessage: `O enunciado deve ter até ${PROMPT_MAX.toLocaleString('pt-BR')} caracteres.`,
    });
  }
}

export function defaultTitle(prompt: string, fallback = 'Tarefa'): string {
  const first = prompt.trim().split(/\r?\n/)[0]?.trim() ?? '';
  const t = first.length > TASK_TITLE_MAX ? `${first.slice(0, TASK_TITLE_MAX - 1)}…` : first;
  return t.length > 0 ? t : fallback;
}

/** Nome padrão de um workspace: a última pasta do caminho. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
  const last = parts[parts.length - 1] ?? 'Workspace';
  return last.length > GROUP_NAME_MAX ? last.slice(0, GROUP_NAME_MAX) : last;
}

export class WorkspaceService {
  constructor(private readonly deps: WorkspaceServiceDeps) {}

  snapshot(): WorkspaceSnapshot {
    return this.deps.model.snapshot();
  }

  subscribe(fn: (s: WorkspaceSnapshot) => void): Unsubscribe {
    return this.deps.model.subscribe(fn);
  }

  async createGroup(name: string): Promise<Group> {
    const group: Group = {
      id: newId(),
      name: validateGroupName(name),
      order: this.deps.model.raw.groups.length,
    };
    this.deps.model.mutate((s) => s.groups.push(group));
    return group;
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const valid = validateGroupName(name);
    if (!this.deps.model.group(id))
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Grupo não encontrado.' });
    this.deps.model.mutate((s) => {
      const g = s.groups.find((x) => x.id === id);
      if (g) g.name = valid;
    });
  }

  /**
   * Abre um workspace a partir de uma pasta: dentro de um repositório git, usa a raiz do repositório;
   * fora do git, a própria pasta. Reaproveita o workspace existente da mesma pasta; senão cria um, com o
   * nome da pasta e a próxima cor.
   */
  async openWorkspace(path: string, name?: string): Promise<Group> {
    const root = await this.folderRoot(path);
    const os = this.deps.residue.os;
    const repoId = repoIdOf(root, os);
    const now = this.deps.clock.now().toISOString();
    const existing = this.deps.model.raw.groups.find((g) => g.repoId === repoId);
    if (existing) {
      this.deps.model.mutate((s) => {
        const g = s.groups.find((x) => x.id === existing.id);
        if (g) g.lastOpenedAt = now;
      });
      return this.deps.model.group(existing.id) ?? existing;
    }
    const groups = this.deps.model.raw.groups;
    const set = normalizeFolders([root], os);
    const group: Group = {
      id: newId(),
      name: validateGroupName(name && name.trim().length > 0 ? name : folderName(root)),
      order: groups.length,
      ...set,
      ...derivedRepo(set, os),
      colorIndex: groups.filter((g) => g.repoPath).length % 6,
      lastOpenedAt: now,
    };
    this.deps.model.mutate((s) => s.groups.push(group));
    this.deps.log.info('workspace.opened', { repoId });
    await this.refreshFolderAvailability();
    return group;
  }

  /**
   * Cria um workspace com nome e uma ou mais pastas (`primaryIndex` escolhe a principal; padrão a primeira).
   * As pastas ficam como foram escolhidas, sem subir para a raiz do repositório, e podem repetir-se em
   * outros workspaces.
   */
  async createWorkspace(name: string, paths: readonly string[], primaryIndex = 0): Promise<Group> {
    const valid = validateWorkspaceName(name);
    if (paths.length === 0)
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Um workspace precisa de ao menos uma pasta.' });
    const os = this.deps.residue.os;
    const set = normalizeFolders(paths, os, primaryIndex);
    for (const folder of set.folders) await this.assertDirectory(folder.path);
    const groups = this.deps.model.raw.groups;
    const group: Group = {
      id: newId(),
      name: valid,
      order: groups.length,
      ...set,
      ...derivedRepo(set, os),
      colorIndex: groups.filter((g) => g.repoPath).length % 6,
      lastOpenedAt: this.deps.clock.now().toISOString(),
    };
    this.deps.model.mutate((s) => s.groups.push(group));
    this.deps.log.info('workspace.created', { groupId: group.id, folders: set.folders.length });
    await this.refreshFolderAvailability();
    return group;
  }

  /** Aplica uma mudança ao workspace (nome ou pastas) e grava; sessões vivas não são tocadas. */
  updateWorkspace(id: string, change: WorkspaceChange): Promise<Group> {
    return this.deps.residue.mutex.run(`workspace:${id}`, async () => {
      const group = this.deps.model.group(id);
      if (!group) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Workspace não encontrado.' });
      const os = this.deps.residue.os;
      const current: FolderSet | null =
        group.folders && group.primaryFolderId
          ? { folders: group.folders, primaryFolderId: group.primaryFolderId }
          : null;
      let next: FolderSet | null = current;
      let name = group.name;
      switch (change.kind) {
        case 'rename':
          name = validateWorkspaceName(change.name);
          break;
        case 'addFolders': {
          if (change.folders.length === 0)
            throw new MelinnaError('INPUT_INVALID', { userMessage: 'Escolha ao menos uma pasta.' });
          const resolved = change.folders.map((p) => pathModule(os).resolve(p));
          for (const p of resolved) await this.assertDirectory(p);
          next = current ?? normalizeFolders(resolved.slice(0, 1), os);
          for (const p of current ? resolved : resolved.slice(1)) next = addFolder(next, p, os);
          break;
        }
        case 'removeFolder':
          next = removeFolder(this.requireFolders(current), change.folderId);
          break;
        case 'setPrimary':
          next = setPrimary(this.requireFolders(current), change.folderId);
          break;
      }
      this.deps.model.mutate((s) => {
        const g = s.groups.find((x) => x.id === id);
        if (!g) return;
        g.name = name;
        if (next) Object.assign(g, next, derivedRepo(next, os));
      });
      this.deps.log.info('workspace.updated', {
        groupId: id,
        folders: next?.folders.length ?? 0,
        change: change.kind,
      });
      await this.refreshFolderAvailability();
      return this.deps.model.group(id) ?? group;
    });
  }

  private requireFolders(set: FolderSet | null): FolderSet {
    if (!set) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Pasta não encontrada neste workspace.' });
    return set;
  }

  private async assertDirectory(path: string): Promise<void> {
    const stat = await this.deps.residue.fs.stat(path).catch(() => null);
    if (!stat?.isDirectory) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: `A pasta ${path} não existe.` });
    }
  }

  /** Confere no disco quais pastas de workspace ainda existem e avisa quem escuta. */
  async refreshFolderAvailability(): Promise<void> {
    const { fs } = this.deps.residue;
    const folders = this.deps.model.raw.groups.flatMap((g) => g.folders ?? []);
    const checks = await Promise.all(
      folders.map(async (f) => ((await fs.stat(f.path).catch(() => null))?.isDirectory ? null : f.id)),
    );
    this.deps.model.setUnavailableFolders(new Set(checks.filter((id): id is string => id !== null)));
  }

  inspectRepo(repoPath: string, baseRef: string): Promise<RepoInspection> {
    return inspectRepo(this.deps.git, repoPath, baseRef, this.deps.residue.os);
  }

  /** Raiz do repositório que contém a pasta ou, fora do git, a própria pasta (que precisa existir). */
  private async folderRoot(path: string): Promise<string> {
    const { fs, os } = this.deps.residue;
    const resolved = pathModule(os).resolve(path);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isDirectory) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: `A pasta ${path} não existe.` });
    }
    return repoRoot(this.deps.git, resolved, os).catch(() => resolved);
  }

  /** Tira o workspace (ou grupo) da lista; a pasta no disco não é tocada. Exige o grupo sem tarefas. */
  removeGroup(id: string): void {
    const { model, log } = this.deps;
    if (!model.group(id))
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Workspace não encontrado.' });
    if (model.raw.tasks.some((t) => t.groupId === id)) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Remova as sessões do workspace antes.' });
    }
    const folders = model.group(id)?.folders?.length ?? 0;
    model.mutate((s) => {
      s.groups = s.groups.filter((g) => g.id !== id);
    });
    log.info('workspace.removed', { groupId: id, folders });
    this.deps.onGroupRemoved?.(id);
  }

  async createTask(input: CreateTaskInput): Promise<Task> {
    // Leitura única do workspace: a principal e as extras valem para esta sessão, mesmo que ele mude depois.
    const group = this.deps.model.group(input.groupId);
    if (!group) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Grupo não encontrado.' });
    const os = this.deps.residue.os;
    const folders =
      group.folders && group.primaryFolderId
        ? { folders: [...group.folders], primaryFolderId: group.primaryFolderId }
        : null;
    validatePrompt(input.prompt);
    const title =
      input.title !== undefined && input.title.trim().length > 0
        ? validateTaskTitle(input.title)
        : defaultTitle(input.prompt, 'Sessão');
    const isolation = input.isolation ?? 'worktree';
    // Execução direta num workspace: o cwd é a pasta principal como foi escolhida, sem subir para a raiz do git.
    const primary = isolation === 'direct' && folders ? primaryOf(folders) : null;
    if (primary) {
      const stat = await this.deps.residue.fs.stat(primary.path).catch(() => null);
      if (!stat?.isDirectory) {
        throw new MelinnaError('INPUT_INVALID', {
          userMessage: `A pasta principal ${primary.path} não está disponível.`,
        });
      }
    }
    const repo = primary
      ? { root: primary.path, baseCommit: '' }
      : isolation === 'direct'
        ? { root: await this.folderRoot(input.repoPath), baseCommit: '' }
        : await this.inspectRepo(input.repoPath, input.baseRef);
    const extraDirs = primary && folders ? extrasOf(folders).map((f) => f.path) : [];
    // Só notifica quando há de fato um workspace com repositório para marcar como aberto agora.
    if (this.deps.model.group(input.groupId)?.repoPath) {
      this.deps.model.mutate((s) => {
        const g = s.groups.find((x) => x.id === input.groupId);
        if (g) g.lastOpenedAt = this.deps.clock.now().toISOString();
      });
    }
    const task: Task = {
      id: newId(),
      groupId: input.groupId,
      title,
      prompt: input.prompt,
      repoPath: repo.root,
      repoId: repoIdOf(repo.root, os),
      baseRef: input.baseRef,
      baseCommit: repo.baseCommit,
      slug: slugify(title),
      createdAt: this.deps.clock.now().toISOString(),
      ...(isolation === 'direct' ? { isolation } : {}),
      ...(extraDirs.length > 0 ? { extraDirs } : {}),
    };
    this.deps.model.mutate((s) => s.tasks.push(task));
    this.deps.log.info('task.created', { taskId: task.id, repoId: task.repoId, size: task.prompt.length });
    return task;
  }

  async renameTask(id: string, title: string): Promise<void> {
    const valid = validateTaskTitle(title);
    if (!this.deps.model.task(id))
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Tarefa não encontrada.' });
    this.deps.model.mutate((s) => {
      const t = s.tasks.find((x) => x.id === id);
      if (t) t.title = valid;
    });
  }

  /** Remove um resíduo apontado por WORKTREE_RESIDUE; recusa caminhos fora da pasta de worktrees ou com lease válido. */
  async cleanResidue(residuePath: string): Promise<void> {
    const { residue, model } = this.deps;
    const p = residue.paths;
    if (!p.isInsideWorktrees(residuePath)) {
      throw new MelinnaError('INPUT_INVALID', {
        userMessage: 'A limpeza só aceita caminhos dentro da pasta de worktrees do app.',
      });
    }
    const repoId = residuePath.slice(p.worktreesRoot.length + 1).split(/[\\/]/)[0] ?? '';
    const repoRoot = model.raw.tasks.find((t) => t.repoId === repoId)?.repoPath ?? null;
    await cleanResidue(residue, {
      residuePath,
      repoRoot,
      isKnownExecution: (execId) => model.execution(execId) !== undefined,
    });
    this.deps.log.info('worktree.residue_cleaned', { repoId });
  }
}
