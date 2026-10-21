import { existing } from './validate-common';

export function parseDiffExecId(exists: (id: string) => boolean) {
  return (args: unknown[]): [string] => [existing(args[0], 'Execução', exists)];
}
