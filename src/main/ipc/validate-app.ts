import type { CloseChoice } from '../../shared/ipc-contract';
import { oneOf } from './validate-common';

export function parseAnswerClose(args: unknown[]): [CloseChoice] {
  return [oneOf(args[0], 'escolha', ['keep-running', 'stop-all', 'cancel'] as const)];
}

export function parseOpenExternal(args: unknown[]): [unknown] {
  return [args[0]];
}
