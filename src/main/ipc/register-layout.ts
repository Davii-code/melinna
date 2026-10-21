import type { FilesService } from '../../core/files/files-service';
import type { Logger } from '../../core/ports/logger';
import type { Pane } from '../../core/persistence/state-schema';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { noArgs } from './validate-common';
import { parseLayoutSet } from './validate-layout';

export interface LayoutIpcDeps {
  model: WorkspaceModel;
  files: FilesService;
  log: Logger;
}

/** Mantém só o que existe: execuções vivas no estado e arquivos dentro de uma raiz navegável. */
function sanitize(panes: readonly Pane[], known: ReadonlySet<string>, files: FilesService): Pane[] {
  const out: Pane[] = [];
  for (const pane of panes) {
    if (pane.kind === 'executions') {
      const execIds = pane.execIds.filter((id) => known.has(id));
      if (execIds.length === 0) continue;
      out.push({ ...pane, execIds, activeIndex: Math.min(pane.activeIndex, execIds.length - 1) });
      continue;
    }
    const docs = pane.docs.filter((path) => files.containsPath(path));
    if (docs.length === 0) continue;
    out.push({ ...pane, docs, activeIndex: Math.min(pane.activeIndex, docs.length - 1) });
  }
  return out;
}

export function registerLayout(handle: Handle, deps: LayoutIpcDeps): void {
  const { model, files, log } = deps;
  const C = CHANNELS.layout;
  handle(
    C.get,
    handler(log, C.get, noArgs, () => structuredClone(model.raw.layout)),
  );
  handle(
    C.set,
    handler(log, C.set, parseLayoutSet, (layout) => {
      const known = new Set(model.raw.executions.map((e) => e.id));
      const panes = sanitize(layout.panes, known, files);
      const focused =
        layout.focusedPaneId !== null && panes.some((pane) => pane.id === layout.focusedPaneId)
          ? layout.focusedPaneId
          : (panes[0]?.id ?? null);
      model.mutate((s) => {
        s.layout = { ...layout, panes, focusedPaneId: focused };
      });
    }),
  );
}
