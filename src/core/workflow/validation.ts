import { MelinnaError } from '../errors';
import type { TaskNotes, UsageProfile } from './types';
export function workflowError(message: string): never {
  throw new MelinnaError('INPUT_INVALID', { userMessage: message });
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) workflowError('Dados inválidos.');
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string, max = 100000, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.trim()) ||
    /[\u0000\u0008\u001b]/.test(value)
  )
    workflowError(label + ' inválido.');
  return value as string;
}
export function identifier(value: unknown): string {
  const id = string(value, 'Identificador', 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) workflowError('Identificador inválido.');
  return id;
}
export function notes(value: unknown): TaskNotes {
  const v = record(value);
  return {
    objective: string(v.objective, 'Objetivo', 100000, true),
    decisions: string(v.decisions, 'Decisões', 20000, true),
    pending: string(v.pending, 'Pendências', 20000, true),
    constraints: string(v.constraints, 'Restrições', 20000, true),
  };
}
export function profile(value: unknown): UsageProfile {
  const v = record(value);
  const agentId = string(v.agentId, 'Agente', 32);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(agentId)) workflowError('Agente inválido.');
  if (typeof v.checkpointBeforeLaunch !== 'boolean') workflowError('Preferência de checkpoint inválida.');
  return {
    id: v.id === '' ? '' : identifier(v.id),
    name: string(v.name, 'Nome', 80),
    groupId: v.groupId === null ? null : identifier(v.groupId),
    agentId,
    model: v.model === null ? null : string(v.model, 'Modelo', 100),
    permission: v.permission === null ? null : string(v.permission, 'Permissão', 100),
    instructions: string(v.instructions, 'Instruções', 20000, true),
    checkpointBeforeLaunch: v.checkpointBeforeLaunch,
  };
}
