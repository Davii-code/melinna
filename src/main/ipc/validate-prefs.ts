import { KEYMAP_IDS, type ActiveRunRef, type KeymapId } from '../../core/prefs/types';
import { existing, id, invalid, isObj, oneOf } from './validate-common';

export function parseKeymap(args: unknown[]): [KeymapId] {
  return [oneOf(args[0], 'mapa de atalhos', KEYMAP_IDS)];
}

export function parseActiveRun(groupExists: (id: string) => boolean) {
  return (args: unknown[]): [ActiveRunRef | null] => {
    const v = args[0];
    if (v === null) return [null];
    if (!isObj(v)) throw invalid('configuração ativa');
    return [
      { groupId: existing(v.groupId, 'Workspace', groupExists), commandId: id(v.commandId, 'configuração') },
    ];
  };
}
