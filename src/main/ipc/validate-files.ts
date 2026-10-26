import type { ProjectSearchQuery } from '../../core/files/search';
import { LIMITS } from '../../shared/ipc-contract';
import { bool, invalid, isObj, noArgs, str } from './validate-common';

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

/** Forma da consulta de busca no projeto; as raízes são conferidas contra as registradas no principal. */
export function parseProjectSearch(args: unknown[]): [ProjectSearchQuery] {
  const v = args[0];
  if (!isObj(v)) throw invalid('busca');
  if (!Array.isArray(v.roots) || v.roots.length > LIMITS.searchRoots) throw invalid('pastas da busca');
  const query: ProjectSearchQuery = {
    roots: v.roots.map((r) => str(r, 'pasta da busca', 1, LIMITS.path)),
    text: str(v.text, 'texto da busca', 0, LIMITS.searchText),
    caseSensitive: bool(v.caseSensitive, 'diferenciar maiúsculas'),
    wholeWord: bool(v.wholeWord, 'palavra inteira'),
    regex: bool(v.regex, 'expressão regular'),
  };
  if (v.include !== undefined) query.include = str(v.include, 'arquivos incluídos', 0, LIMITS.searchMask);
  if (v.exclude !== undefined) query.exclude = str(v.exclude, 'arquivos excluídos', 0, LIMITS.searchMask);
  return [query];
}
