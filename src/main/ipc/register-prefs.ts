import type { PreferencesStore } from '../../core/prefs/preferences-store';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { noArgs } from './validate-common';
import { parseActiveRun, parseKeymap } from './validate-prefs';

export interface PrefsIpcDeps {
  prefs: PreferencesStore;
  model: WorkspaceModel;
  log: Logger;
}

/** Canais das preferências do usuário: mapa de atalhos e configuração de execução ativa. */
export function registerPrefs(handle: Handle, deps: PrefsIpcDeps): void {
  const { prefs, model, log } = deps;
  const C = CHANNELS.prefs;
  const groupExists = (id: string) => model.group(id) !== undefined;
  handle(
    C.get,
    handler(log, C.get, noArgs, () => prefs.get()),
  );
  handle(
    C.setKeymap,
    handler(log, C.setKeymap, parseKeymap, async (keymap) => {
      await prefs.setKeymap(keymap);
      log.info('prefs.keymap_changed', { keymap });
    }),
  );
  handle(
    C.setActiveRun,
    handler(log, C.setActiveRun, parseActiveRun(groupExists), (ref) => prefs.setActiveRun(ref)),
  );
}
