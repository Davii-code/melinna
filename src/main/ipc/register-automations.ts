import type { AutomationScheduler } from '../../core/automations/automation-scheduler';
import type { AutomationStore } from '../../core/automations/automation-store';
import type { Logger } from '../../core/ports/logger';
import { CHANNELS, type AutomationListing } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { bool, id, noArgs } from './validate-common';

export interface AutomationsIpcDeps {
  store: Pick<AutomationStore, 'list' | 'isReadOnly' | 'save' | 'remove' | 'setEnabled'>;
  scheduler: Pick<AutomationScheduler, 'nextRunAt' | 'runNow'>;
  log: Logger;
}

const automationId = (args: unknown[]): [string] => [id(args[0], 'automação')];

/** Canais das automações agendadas; o enunciado nunca vai para o log. */
export function registerAutomations(handle: Handle, deps: AutomationsIpcDeps): void {
  const { store, scheduler, log } = deps;
  const C = CHANNELS.automations;
  handle(
    C.list,
    handler(log, C.list, noArgs, (): AutomationListing => ({
      automations: store.list().map((a) => ({ ...a, nextRunAt: scheduler.nextRunAt(a.id) })),
      readOnly: store.isReadOnly(),
    })),
  );
  handle(
    C.save,
    // O conteúdo é validado pelo armazenamento, que conhece as regras do agendamento.
    handler(log, C.save, (args: unknown[]): [unknown] => [args[0]], (input) => store.save(input)),
  );
  handle(
    C.remove,
    handler(log, C.remove, automationId, (automation) => store.remove(automation)),
  );
  handle(
    C.setEnabled,
    handler(
      log,
      C.setEnabled,
      (args: unknown[]): [string, boolean] => [id(args[0], 'automação'), bool(args[1], 'estado')],
      (automation, enabled) => store.setEnabled(automation, enabled),
    ),
  );
  handle(
    C.runNow,
    handler(log, C.runNow, automationId, (automation) => scheduler.runNow(automation)),
  );
}
