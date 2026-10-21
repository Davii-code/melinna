import { LIMITS } from '../../shared/ipc-contract';
import { invalid, noArgs, str } from './validate-common';

export const parseFilesRoots = noArgs;

/** Caminho absoluto a listar ou ler; a contenção nas raízes é verificada pelo serviço, com `realpath`. */
export function parseFilePath(args: unknown[]): [string] {
  return [str(args[0], 'caminho do arquivo', 1, LIMITS.path)];
}

const HASH_HEX = /^[0-9a-f]{64}$/;

/** Escrita: caminho, conteúdo e o hash que o editor leu; conteúdo limitado ao mesmo teto da leitura. */
export function parseFileWrite(args: unknown[]): [string, string, string] {
  const path = str(args[0], 'caminho do arquivo', 1, LIMITS.path);
  const content = str(args[1], 'conteúdo do arquivo', 0, LIMITS.fileText);
  const hash = str(args[2], 'hash do arquivo', 64, 64);
  if (!HASH_HEX.test(hash)) throw invalid('hash do arquivo');
  return [path, content, hash];
}
