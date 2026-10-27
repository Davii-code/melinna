import { CHANNELS } from '../../shared/ipc-contract';
import type { OrchestrationService } from '../../core/orchestration/orchestration-service';
import type { Logger } from '../../core/ports/logger';
import { id, invalid, text } from '../../core/orchestration/validation';
import { toResult, type Handle } from './result';

export function registerOrchestration(handle: Handle, service: OrchestrationService, log: Logger): void {
  const channels = CHANNELS.orchestration;
  const register = (channel: string, operation: (args: unknown[]) => unknown | Promise<unknown>) => {
    handle(channel, (...args) => toResult(log, channel, () => operation(args)));
  };
  register(channels.snapshot, () => service.snapshot());
  register(channels.saveTeam, (args) => service.saveTeam(args[0]));
  register(channels.removeTeam, (args) => service.removeTeam(id(args[0])));
  register(channels.preflight, (args) => service.preflight(args[0]));
  register(channels.start, (args) => service.start(args[0]));
  register(channels.message, (args) => service.message(id(args[0]), text(args[1], 'Mensagem')));
  register(channels.control, (args) => {
    const action = args[1];
    if (action !== 'pause' && action !== 'resume' && action !== 'cancel') invalid('Ação inválida.');
    return service.control(id(args[0]), action);
  });
  register(channels.cancelJob, (args) => service.cancelJob(id(args[0]), id(args[1])));
  register(channels.retryJob, (args) => service.retryJob(id(args[0]), id(args[1])));
  register(channels.patch, (args) => service.patch(id(args[0]), id(args[1])));
  register(channels.applyPatch, (args) => service.applyPatch(id(args[0]), id(args[1])));
}
