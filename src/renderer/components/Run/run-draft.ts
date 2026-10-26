import type {
  MelinnaApi,
  RunCommand,
  RunConfigInput,
  RunConfigTool,
  RunConfigView,
  RunReorderItem,
} from '../../../shared/ipc-contract';
import { copyName } from '../../../shared/run-names';
import { errorMessage, unwrap } from '../../api';
import { inputFromDetected } from '../../store/run-store';
import { toolGroupOf } from './tool-groups';

/** Configuração em edição na janela: valores ainda não gravados, mais o que a lista informou. */
export interface DraftItem {
  /** Identifica a linha na janela: o id da salva, ou `novo:N` até ser gravada. */
  key: string;
  /** Id da configuração salva; `null` enquanto é nova. */
  id: string | null;
  groupId: string;
  name: string;
  tool: RunConfigTool;
  folder: string;
  script: string | null;
  program: string;
  args: string[];
  runtimeOptions: string;
  env: { name: string; value: string }[];
  beforeLaunch: string | null;
  allowParallel: boolean;
  folderGroup: string | null;
  order: number;
  /** Instâncias vivas (só leitura). */
  running: number;
  available: boolean;
}

export { TOOL_GROUPS, toolGroupOf, type ToolGroup } from './tool-groups';

export function draftFromView(v: RunConfigView): DraftItem {
  return {
    key: v.id,
    id: v.id,
    groupId: v.groupId,
    name: v.name,
    tool: v.tool,
    folder: v.folder,
    script: v.script,
    program: v.program,
    args: [...v.args],
    runtimeOptions: v.runtimeOptions,
    env: v.env.map((e) => ({ ...e })),
    beforeLaunch: v.beforeLaunch,
    allowParallel: v.allowParallel,
    folderGroup: v.folderGroup,
    order: v.order,
    running: v.running,
    available: v.available,
  };
}

function nextOrder(items: readonly DraftItem[], tool: RunConfigTool, folderGroup: string | null): number {
  const group = toolGroupOf(tool);
  const same = items.filter((i) => toolGroupOf(i.tool) === group && i.folderGroup === folderGroup);
  return same.length === 0 ? 0 : Math.max(...same.map((i) => i.order)) + 1;
}

function fromInput(
  input: RunConfigInput,
  groupId: string,
  key: string,
  items: readonly DraftItem[],
): DraftItem {
  return {
    key,
    id: null,
    groupId,
    name: input.name,
    tool: input.tool,
    folder: input.folder,
    script: input.script,
    program: input.program,
    args: [...input.args],
    runtimeOptions: input.runtimeOptions,
    env: input.env.map((e) => ({ ...e })),
    beforeLaunch: input.beforeLaunch,
    allowParallel: input.allowParallel,
    folderGroup: input.folderGroup,
    order: nextOrder(items, input.tool, input.folderGroup),
    running: 0,
    available: true,
  };
}

/** Nome livre entre os existentes: "Nova configuração", "Nova configuração 2"… */
export function freshName(base: string, names: readonly string[]): string {
  const taken = new Set(names.map((n) => n.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

/** Configuração nova em branco da ferramenta, na primeira pasta do workspace. */
export function blankDraft(
  tool: RunConfigTool,
  groupId: string,
  folder: string,
  key: string,
  items: readonly DraftItem[],
): DraftItem {
  return fromInput(
    {
      name: freshName(
        'Nova configuração',
        items.map((i) => i.name),
      ),
      tool,
      folder,
      script: null,
      program: '',
      args: [],
      runtimeOptions: '',
      env: [],
      beforeLaunch: null,
      allowParallel: false,
      folderGroup: null,
    },
    groupId,
    key,
    items,
  );
}

/** Configuração nova a partir de um script detectado (ferramenta, script e pasta já preenchidos). */
export function draftFromDetected(command: RunCommand, key: string, items: readonly DraftItem[]): DraftItem {
  const names = items.filter((i) => i.groupId === command.groupId).map((i) => i.name);
  return fromInput(inputFromDetected(command, names), command.groupId, key, items);
}

/** Cópia ("X (cópia)", "X (cópia 2)"…) no fim do mesmo grupo, ainda não gravada. */
export function copyDraft(item: DraftItem, key: string, items: readonly DraftItem[]): DraftItem {
  const names = items.filter((i) => i.groupId === item.groupId).map((i) => i.name);
  return {
    ...item,
    env: item.env.map((e) => ({ ...e })),
    args: [...item.args],
    key,
    id: null,
    name: copyName(item.name, names),
    order: nextOrder(items, item.tool, item.folderGroup),
    running: 0,
    available: true,
  };
}

export function toInput(item: DraftItem): RunConfigInput {
  return {
    ...(item.id === null ? {} : { id: item.id }),
    name: item.name,
    tool: item.tool,
    folder: item.folder,
    script: item.script,
    program: item.program,
    args: item.args,
    runtimeOptions: item.runtimeOptions,
    env: item.env,
    beforeLaunch: item.beforeLaunch,
    allowParallel: item.allowParallel,
    folderGroup: item.folderGroup,
  };
}

/** Move a configuração para uma pasta de agrupamento (ou para fora de qualquer pasta), no fim do destino. */
export function moveToFolder(items: DraftItem[], key: string, folderGroup: string | null): DraftItem[] {
  const item = items.find((i) => i.key === key);
  if (!item || item.folderGroup === folderGroup) return items;
  const order = nextOrder(
    items.filter((i) => i.key !== key),
    item.tool,
    folderGroup,
  );
  return items.map((i) => (i.key === key ? { ...i, folderGroup, order } : i));
}

/** Ordem alfabética (sem diferenciar maiúsculas) dentro de cada grupo de ferramenta e pasta. */
export function sortAlphabetically(items: DraftItem[]): DraftItem[] {
  const groups = new Map<string, DraftItem[]>();
  for (const item of items) {
    const id = `${toolGroupOf(item.tool)}|${item.folderGroup ?? ''}`;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  const orderOf = new Map<string, number>();
  for (const list of groups.values()) {
    [...list]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .forEach((item, i) => orderOf.set(item.key, i));
  }
  return items.map((i) => ({ ...i, order: orderOf.get(i.key) ?? i.order }));
}

function sameDraft(a: DraftItem, v: RunConfigView): boolean {
  return JSON.stringify(toInput(a)) === JSON.stringify(toInput(draftFromView(v)));
}

/** Há alteração em relação ao que está gravado? */
export function isDirty(
  original: readonly RunConfigView[],
  items: readonly DraftItem[],
  removedIds: readonly string[],
): boolean {
  if (removedIds.length > 0) return true;
  return items.some((item) => {
    if (item.id === null) return true;
    const v = original.find((o) => o.id === item.id);
    return !v || !sameDraft(item, v) || v.order !== item.order;
  });
}

/** `ids` leva a chave de cada linha da janela ao id gravado (as novas ganham o id aqui). */
export type ApplyResult =
  { ok: true; ids: Map<string, string> } | { ok: false; message: string; key: string | null };

/**
 * Grava as alterações no principal: remoções, depois cada configuração nova ou alterada (uma etapa de
 * "Antes de lançar" nova é gravada antes de quem a usa) e por fim as posições. Para no primeiro erro e
 * devolve a mensagem do principal; o que já foi gravado fica gravado.
 */
export async function applyDraft(
  api: MelinnaApi,
  groupId: string,
  original: readonly RunConfigView[],
  items: readonly DraftItem[],
  removedIds: readonly string[],
): Promise<ApplyResult> {
  try {
    for (const id of removedIds) await unwrap(api.run.removeConfig(groupId, id));
    const savedIds = new Map<string, string>();
    for (const item of items) if (item.id !== null) savedIds.set(item.key, item.id);
    const dirty = items.filter((item) => {
      if (item.id === null) return true;
      const v = original.find((o) => o.id === item.id);
      return !v || !sameDraft(item, v);
    });
    const pending = [...dirty];
    while (pending.length > 0) {
      const index = pending.findIndex(
        (item) =>
          item.beforeLaunch === null ||
          savedIds.has(item.beforeLaunch) ||
          !isNewKey(items, item.beforeLaunch),
      );
      if (index < 0) {
        return {
          ok: false,
          message: 'As etapas de "Antes de lançar" formam um ciclo.',
          key: pending[0]?.key ?? null,
        };
      }
      const item = pending.splice(index, 1)[0] as DraftItem;
      try {
        const before =
          item.beforeLaunch === null ? null : (savedIds.get(item.beforeLaunch) ?? item.beforeLaunch);
        const saved = await unwrap(api.run.saveConfig(groupId, { ...toInput(item), beforeLaunch: before }));
        savedIds.set(item.key, saved.id);
      } catch (err) {
        return { ok: false, message: errorMessage(err), key: item.key };
      }
    }
    const moves: RunReorderItem[] = [];
    for (const item of items) {
      const id = savedIds.get(item.key);
      if (id === undefined) continue;
      const v = original.find((o) => o.id === id);
      if (!v || v.order !== item.order || v.folderGroup !== item.folderGroup || item.id === null) {
        moves.push({ id, folderGroup: item.folderGroup, order: item.order });
      }
    }
    if (moves.length > 0) await unwrap(api.run.reorder(groupId, moves));
    return { ok: true, ids: savedIds };
  } catch (err) {
    return { ok: false, message: errorMessage(err), key: null };
  }
}

function isNewKey(items: readonly DraftItem[], keyOrId: string): boolean {
  return items.some((i) => i.key === keyOrId && i.id === null);
}
