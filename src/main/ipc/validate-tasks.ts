import type { AgentPick, CreateAndLaunchInput } from '../../shared/ipc-contract';
import { LIMITS } from '../../shared/ipc-contract';
import { MelinnaError } from '../../core/errors';
import { existing, invalid, isObj, optStr, str, termSize } from './validate-common';

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

function pick(v: unknown): AgentPick {
  if (!isObj(v) || typeof v.agentId !== 'string' || !AGENT_ID.test(v.agentId)) throw invalid('agente');
  const out: AgentPick = { agentId: v.agentId };
  if (v.model !== undefined)
    out.model = v.model === null ? null : str(v.model, 'modelo', 1, LIMITS.modelOrMode);
  if (v.permission !== undefined)
    out.permission =
      v.permission === null ? null : str(v.permission, 'modo de permissão', 1, LIMITS.modelOrMode);
  return out;
}

export function parseCreateAndLaunch(groupExists: (id: string) => boolean, freeSlots: () => number) {
  return (args: unknown[]): [CreateAndLaunchInput] => {
    const v = args[0];
    if (!isObj(v)) throw invalid('tarefa');
    if (!Array.isArray(v.picks) || v.picks.length === 0) throw invalid('agentes');
    const picks = v.picks.map(pick);
    if (picks.length > freeSlots()) {
      throw new MelinnaError('LIMIT_REACHED', {
        userMessage: `Há só ${freeSlots()} vaga(s) para execuções vivas.`,
      });
    }
    const input: CreateAndLaunchInput = {
      groupId: existing(v.groupId, 'Grupo', groupExists),
      repoPath: str(v.repoPath, 'caminho do repositório'),
      baseRef: str(v.baseRef, 'ponto de partida', 1, LIMITS.baseRef),
      prompt: str(v.prompt, 'enunciado', 0, LIMITS.prompt),
      picks,
      size: termSize(v.size),
    };
    const title = optStr(v.title, 'título', LIMITS.taskTitle);
    if (title !== undefined && title.length > 0) input.title = title;
    return [input];
  };
}
