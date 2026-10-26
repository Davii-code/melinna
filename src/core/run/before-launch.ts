import { MelinnaError } from '../errors';
import type { RunConfig } from './types';

/**
 * A cadeia de "antes de lançar" de uma configuração, na ordem de execução: a etapa mais distante primeiro
 * e a própria configuração por último. Recusa ciclo (`RUN_CONFIG_CYCLE`, com a cadeia nos detalhes) e etapa
 * que não existe (`RUN_CONFIG_INVALID`).
 */
export function chainOf(configs: readonly RunConfig[], id: string): RunConfig[] {
  const byId = new Map(configs.map((c) => [c.id, c]));
  const start = byId.get(id);
  if (!start) throw new MelinnaError('RUN_CONFIG_MISSING');
  const visited = new Set<string>();
  const forward: RunConfig[] = [];
  let current: RunConfig | undefined = start;
  while (current !== undefined) {
    if (visited.has(current.id)) {
      const names = [...forward.map((c) => c.name), current.name];
      const chain = names.join(' → ');
      throw new MelinnaError('RUN_CONFIG_CYCLE', {
        userMessage: `"Antes de lançar" forma um ciclo: ${chain}.`,
        details: { chain },
      });
    }
    visited.add(current.id);
    forward.push(current);
    const next: string | null = current.beforeLaunch;
    if (next === null) break;
    current = byId.get(next);
    if (current === undefined) {
      throw new MelinnaError('RUN_CONFIG_INVALID', {
        userMessage: 'A etapa de "Antes de lançar" não existe mais.',
        details: { field: 'beforeLaunch', reason: 'missing' },
      });
    }
  }
  return forward.reverse();
}
