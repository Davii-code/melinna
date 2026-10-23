import { MelinnaError } from '../errors';
import { newId } from '../ids';
import type { Clock } from '../ports/clock';
import type { Logger } from '../ports/logger';
import type { PromptStore } from './prompt-store';
import {
  PROMPT_BODY_MAX,
  PROMPT_NAME_MAX,
  type Prompt,
  type PromptScope,
  type StoredPrompt,
} from './types';
import { assertNoControlChars, extractVariables, normalizeNewlines } from './variables';

export interface PromptLibraryDeps {
  store: PromptStore;
  groupExists: (groupId: string) => boolean;
  clock: Clock;
  log: Logger;
}

export interface SavePromptInput {
  id?: string;
  name: string;
  body: string;
  scope: PromptScope;
}

const COPY_SUFFIX = ' (cópia)';

function invalid(userMessage: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage });
}

function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > PROMPT_NAME_MAX || /[\r\n]/.test(trimmed)) {
    throw invalid(`O nome do prompt deve ter de 1 a ${PROMPT_NAME_MAX} caracteres, sem quebra de linha.`);
  }
  return trimmed;
}

function validBody(raw: string): string {
  const body = normalizeNewlines(raw);
  if (body.length < 1 || body.length > PROMPT_BODY_MAX) {
    throw invalid('O prompt deve ter até 100.000 caracteres.');
  }
  assertNoControlChars(body);
  return body;
}

function withVariables(p: StoredPrompt): Prompt {
  return { ...p, variables: extractVariables(p.body) };
}

function inScope(p: StoredPrompt, groupId: string | undefined): boolean {
  if (p.scope === 'global') return true;
  return groupId !== undefined && p.scope.groupId === groupId;
}

/** Biblioteca de prompts: validação, escopo (global ou de um workspace) e persistência pelo `PromptStore`. */
export class PromptLibrary {
  constructor(private readonly deps: PromptLibraryDeps) {}

  /** Prompts globais e os do workspace, em ordem alfabética; sem `groupId`, só os globais. */
  list(groupId?: string): Prompt[] {
    return this.deps.store
      .data()
      .prompts.filter((p) => inScope(p, groupId))
      .map(withVariables)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }

  async save(input: SavePromptInput): Promise<Prompt> {
    const { store, clock, log } = this.deps;
    const name = validName(input.name);
    const body = validBody(input.body);
    if (input.scope !== 'global' && !this.deps.groupExists(input.scope.groupId)) {
      throw invalid('Workspace não encontrado.');
    }
    const now = clock.now().toISOString();
    let saved!: StoredPrompt;
    await store.update((d) => {
      if (input.id === undefined) {
        saved = { id: newId(), name, body, scope: input.scope, createdAt: now, updatedAt: now };
        d.prompts.push(saved);
        return;
      }
      const current = d.prompts.find((p) => p.id === input.id);
      if (!current) throw invalid('Prompt não encontrado.');
      Object.assign(current, { name, body, scope: input.scope, updatedAt: now });
      saved = current;
    });
    log.info('prompts.saved', { promptId: saved.id, size: body.length });
    return withVariables(saved);
  }

  async duplicate(id: string): Promise<Prompt> {
    const source = this.deps.store.data().prompts.find((p) => p.id === id);
    if (!source) throw invalid('Prompt não encontrado.');
    const name = `${source.name.slice(0, PROMPT_NAME_MAX - COPY_SUFFIX.length)}${COPY_SUFFIX}`;
    return this.save({ name, body: source.body, scope: source.scope });
  }

  async remove(id: string): Promise<void> {
    if (!this.deps.store.data().prompts.some((p) => p.id === id)) throw invalid('Prompt não encontrado.');
    await this.deps.store.update((d) => {
      d.prompts = d.prompts.filter((p) => p.id !== id);
    });
    this.deps.log.info('prompts.deleted', { promptId: id });
  }

  countForGroup(groupId: string): number {
    return this.deps.store.data().prompts.filter((p) => p.scope !== 'global' && p.scope.groupId === groupId)
      .length;
  }

  /** Remove os prompts do escopo de um workspace; devolve quantos saíram. */
  async removeForGroup(groupId: string): Promise<number> {
    const count = this.countForGroup(groupId);
    if (count === 0) return 0;
    await this.deps.store.update((d) => {
      d.prompts = d.prompts.filter((p) => p.scope === 'global' || p.scope.groupId !== groupId);
    });
    this.deps.log.info('prompts.group_removed', { groupId, count });
    return count;
  }

  /** Remoção em cascata disparada pela remoção do workspace; falha de gravação só vai para o log. */
  releaseGroup(groupId: string): void {
    this.removeForGroup(groupId).catch((err: unknown) => {
      this.deps.log.error('prompts.group_removal_failed', { err, groupId });
    });
  }
}
