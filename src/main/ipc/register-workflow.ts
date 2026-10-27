import { CHANNELS } from '../../shared/ipc-contract';
import type { WorkflowService } from '../../core/workflow/workflow-service';
import type { Logger } from '../../core/ports/logger';
import { identifier, record, string, workflowError } from '../../core/workflow/validation';
import { pick } from './validate-tasks';
import { termSize } from './validate-common';
import { toResult, type Handle } from './result';
export function registerWorkflow(handle: Handle, service: WorkflowService, log: Logger): void {
  const c = CHANNELS.workflow;
  const register = (channel: string, operation: (args: unknown[]) => unknown | Promise<unknown>) =>
    handle(channel, (...args) => toResult(log, channel, () => operation(args)));
  register(c.snapshot, () => service.snapshot());
  register(c.saveProfile, (a) => service.saveProfile(a[0]));
  register(c.removeProfile, (a) => service.removeProfile(identifier(a[0])));
  register(c.preferences, (a) => service.preferences(a[0]));
  register(c.review, (a) =>
    service.review(identifier(a[0]), a[1] === undefined ? undefined : identifier(a[1])),
  );
  register(c.saveNotes, (a) => service.saveNotes(identifier(a[0]), a[1]));
  register(c.checkpoint, (a) => service.checkpoint(identifier(a[0]), string(a[1], 'Nome', 100)));
  register(c.diff, (a) =>
    service.diff(
      identifier(a[0]),
      identifier(a[1]),
      string(a[2], 'Pasta', 4096),
      string(a[3], 'Arquivo', 4096),
    ),
  );
  register(c.previewRestore, (a) => service.previewRestore(identifier(a[0])));
  register(c.restore, (a) => service.restore(identifier(a[0])));
  register(c.draftHandoff, (a) => service.draftHandoff(identifier(a[0])));
  register(c.handoff, (a) => {
    const v = record(a[0]);
    return service.handoff({
      executionId: identifier(v.executionId),
      briefing: string(v.briefing, 'Resumo'),
      pick: pick(v.pick),
      size: termSize(v.size),
    });
  });
  register(c.verify, (a) => {
    if (a[3] !== undefined && a[3] !== 'wrapper-sh' && a[3] !== 'system-tool')
      workflowError('Escolha de execução inválida.');
    return service.verify(identifier(a[0]), identifier(a[1]), termSize(a[2]), a[3]);
  });
  register(c.cancelVerification, (a) => service.cancelVerification(identifier(a[0])));
  register(c.markRead, () => service.markRead());
}
