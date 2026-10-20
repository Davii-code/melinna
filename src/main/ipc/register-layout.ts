import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { noArgs } from './validate-common';
import { parseLayoutSet } from './validate-layout';

export function registerLayout(handle: Handle, deps: { model: WorkspaceModel; log: Logger }): void {
  const { model, log } = deps;
  const C = CHANNELS.layout;
  handle(
    C.get,
    handler(log, C.get, noArgs, () => structuredClone(model.raw.layout)),
  );
  handle(
    C.set,
    handler(log, C.set, parseLayoutSet, (layout) => {
      const known = new Set(model.raw.executions.map((e) => e.id));
      const openExecutionIds = layout.openExecutionIds.filter((x) => known.has(x));
      const focused =
        layout.focusedExecutionId && known.has(layout.focusedExecutionId) ? layout.focusedExecutionId : null;
      model.mutate((s) => {
        s.layout = { ...layout, openExecutionIds, focusedExecutionId: focused };
      });
    }),
  );
}
