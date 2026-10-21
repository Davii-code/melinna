import { LIMITS } from '../../shared/ipc-contract';
import { noArgs, str } from './validate-common';

export const parseFilesRoots = noArgs;

/** Caminho absoluto a listar ou ler; a contenção nas raízes é verificada pelo serviço, com `realpath`. */
export function parseFilePath(args: unknown[]): [string] {
  return [str(args[0], 'caminho do arquivo', 1, LIMITS.path)];
}
