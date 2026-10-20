import { MelinnaError } from '../errors';

export const MAX_LIVE_EXECUTIONS = 12;

export function freeSlots(liveCount: number): number {
  return Math.max(0, MAX_LIVE_EXECUTIONS - liveCount);
}

/** Recusa lançar mais execuções do que as vagas livres. */
export function assertWithinLimit(liveCount: number, requested: number): void {
  if (requested > freeSlots(liveCount)) {
    throw new MelinnaError('LIMIT_REACHED', {
      userMessage: `Limite de ${MAX_LIVE_EXECUTIONS} execuções vivas: há ${freeSlots(liveCount)} vaga(s) livre(s).`,
      details: { liveCount, requested },
    });
  }
}
