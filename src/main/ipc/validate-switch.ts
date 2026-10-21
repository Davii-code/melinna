import { LIMITS, type SwitchKind } from '../../shared/ipc-contract';
import { existing, id, oneOf, str } from './validate-common';

export function parseRequestSwitch(exists: (id: string) => boolean) {
  return (args: unknown[]): [string, SwitchKind, string] => [
    existing(args[0], 'Execução', exists),
    oneOf(args[1], 'tipo de troca', ['model', 'permission'] as const),
    str(args[2], 'valor da troca', 1, LIMITS.modelOrMode),
  ];
}

export function parseConfirmSwitch(exists: (id: string) => boolean) {
  return (args: unknown[]): [string, string] => [existing(args[0], 'Execução', exists), id(args[1], 'plano de troca')];
}

export function parseCancelSwitch(exists: (id: string) => boolean) {
  return (args: unknown[]): [string] => [existing(args[0], 'Execução', exists)];
}
