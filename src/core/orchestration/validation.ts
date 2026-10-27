import { MelinnaError } from '../errors';
import type { AgentRole, TeamTemplate } from './types';

export function invalid(message: string): never {
  throw new MelinnaError('INPUT_INVALID', { userMessage: message });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Objeto inválido.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 100000, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    /[\u0000\u0008\u001b]/.test(value)
  )
    invalid(label + ' inválido.');
  return value as string;
}
export function id(value: unknown): string {
  const result = text(value, 'Identificador', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) invalid('Identificador inválido.');
  return result;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    invalid('Limite fora do intervalo permitido.');
  return value as number;
}
function role(value: unknown): AgentRole {
  const v = object(value);
  if (v.provider !== 'claude' && v.provider !== 'codex') invalid('Provedor não suportado.');
  if (v.access !== 'read-only' && v.access !== 'workspace-write') invalid('Permissão inválida.');
  const model = text(v.model, 'Modelo', 100, true);
  if (model && !/^[A-Za-z0-9._:/@-]+$/.test(model)) invalid('Modelo inválido.');
  return {
    id: id(v.id),
    name: text(v.name, 'Nome do papel', 80),
    provider: v.provider,
    model,
    instructions: text(v.instructions, 'Instruções', 20000, true),
    access: v.access,
  };
}
export function parseTeam(value: unknown): TeamTemplate {
  const v = object(value);
  if (!Array.isArray(v.workers) || v.workers.length < 1 || v.workers.length > 12)
    invalid('Escolha de um a doze trabalhadores.');
  const coordinator = role(v.coordinator);
  if (coordinator.access !== 'read-only') invalid('O coordenador deve operar em somente leitura.');
  const workers = v.workers.map(role);
  if (new Set([coordinator.id, ...workers.map((w) => w.id)]).size !== workers.length + 1)
    invalid('Os papéis precisam ter identificadores diferentes.');
  const l = object(v.limits);
  return {
    id: v.id === '' ? '' : id(v.id),
    name: text(v.name, 'Nome da equipe', 80),
    coordinator,
    workers,
    limits: {
      parallel: integer(l.parallel, 1, 4),
      jobs: integer(l.jobs, 1, 32),
      timeoutMinutes: integer(l.timeoutMinutes, 1, 120),
      maxTurns: integer(l.maxTurns, 1, 32),
      maxTokens: integer(l.maxTokens, 1000, 10000000),
    },
  };
}
