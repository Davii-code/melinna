import type { Logger } from '../../core/ports/logger';
import { CHANNELS } from '../../shared/ipc-contract';
import type { CloseFlow } from '../close-flow';
import { openExternal } from '../open-external';
import { handler, type Handle } from './result';
import { parseAnswerClose, parseOpenExternal } from './validate-app';

export function registerApp(
  handle: Handle,
  deps: { closeFlow: CloseFlow; log: Logger; open: (url: string) => Promise<void> },
): void {
  const { closeFlow, log } = deps;
  const C = CHANNELS.app;
  handle(
    C.answerClose,
    handler(log, C.answerClose, parseAnswerClose, (choice) => closeFlow.answer(choice)),
  );
  handle(
    C.openExternal,
    handler(log, C.openExternal, parseOpenExternal, (url) => openExternal(url, deps.open)),
  );
}
