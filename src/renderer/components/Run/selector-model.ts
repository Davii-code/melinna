import type {
  Group,
  RunConfigUnavailableReason,
  RunConfigView,
  RunWarning,
} from '../../../shared/ipc-contract';
import { TOOL_GROUPS, toolGroupOf, type ToolGroup } from './tool-groups';

export interface SelectorToolGroup {
  id: ToolGroup;
  label: string;
  configs: RunConfigView[];
}

export interface SelectorWorkspace {
  group: Group;
  tools: SelectorToolGroup[];
  warnings: RunWarning[];
}

const UNAVAILABLE_TEXT: Record<RunConfigUnavailableReason, (c: RunConfigView) => string> = {
  'folder-missing': () => 'pasta fora do workspace',
  'program-missing': (c) => `não encontrado: ${c.searched}`,
  'script-missing': () => 'script não existe mais',
  'before-launch-missing': () => 'etapa de "Antes de lançar" removida',
  'unsafe-target': () => 'só roda por .cmd/.bat; use o executável',
};

/** Por que a configuração não pode rodar, ou `null` quando pode. */
export function unavailableNote(c: RunConfigView): string | null {
  if (c.unavailableReason !== null) return UNAVAILABLE_TEXT[c.unavailableReason](c);
  return c.available ? null : 'indisponível';
}

/** Na ordem do grupo: as soltas, depois as de cada pasta de agrupamento (por nome da pasta). */
function inTreeOrder(list: readonly RunConfigView[]): RunConfigView[] {
  const byOrder = (a: RunConfigView, b: RunConfigView) => a.order - b.order;
  const loose = list.filter((c) => c.folderGroup === null).sort(byOrder);
  const folders = [...new Set(list.flatMap((c) => (c.folderGroup === null ? [] : [c.folderGroup])))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
  return [...loose, ...folders.flatMap((f) => list.filter((c) => c.folderGroup === f).sort(byOrder))];
}

/**
 * Monta o que o seletor mostra: por workspace (na ordem dele) e por ferramenta, só as configurações salvas.
 * Workspace sem configuração e sem aviso de detecção fica de fora. Uma passada só pelas configurações.
 */
export function buildSelectorModel(
  configs: readonly RunConfigView[],
  groups: readonly Group[],
  warnings: readonly RunWarning[],
): SelectorWorkspace[] {
  const byGroup = new Map<string, Map<ToolGroup, RunConfigView[]>>();
  for (const config of configs) {
    const tools = byGroup.get(config.groupId) ?? new Map<ToolGroup, RunConfigView[]>();
    const tool = toolGroupOf(config.tool);
    tools.set(tool, [...(tools.get(tool) ?? []), config]);
    byGroup.set(config.groupId, tools);
  }
  const out: SelectorWorkspace[] = [];
  for (const group of [...groups].sort((a, b) => a.order - b.order)) {
    const own = byGroup.get(group.id);
    const groupWarnings = warnings.filter((w) => w.groupId === group.id);
    if (own === undefined && groupWarnings.length === 0) continue;
    const tools: SelectorToolGroup[] = [];
    for (const tool of TOOL_GROUPS) {
      const list = own?.get(tool.id);
      if (list !== undefined) tools.push({ id: tool.id, label: tool.label, configs: inTreeOrder(list) });
    }
    out.push({ group, tools, warnings: groupWarnings });
  }
  return out;
}
