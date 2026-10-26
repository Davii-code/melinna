import { MelinnaError } from '../errors';
import { pathModule } from '../paths';
import type { FileSystem } from '../ports/file-system';
import type { OsName } from '../ports/platform';
import { looksBinary, naturalCompare } from './tree';

import type { ProjectSearchQuery, ProjectSearchResult } from './search-types';

export type { ProjectSearchQuery, ProjectSearchResult, SearchHit } from './search-types';

export const SEARCH_MAX_HITS = 2000;
export const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const SEARCH_MAX_PREVIEW = 300;

/** Pastas que nunca entram na busca: as mesmas que o explorador não indexa. */
export const SEARCH_SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'coverage',
  'build',
  '.next',
  '.turbo',
  '.cache',
]);

export interface SearchControl {
  /** Verdadeiro quando a busca foi cancelada; conferido entre um arquivo e outro. */
  isCancelled?: () => boolean;
  /** Prazo: passado `at` (em ms, na escala de `now`), a busca para com `SEARCH_TIMEOUT`. */
  deadline?: { now: () => number; at: number };
}

export interface SearchDeps {
  fs: FileSystem;
  os: OsName;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Monta a expressão de uma linha; expressão inválida vira `SEARCH_REGEX_INVALID`. */
export function buildMatcher(
  query: Pick<ProjectSearchQuery, 'text' | 'caseSensitive' | 'wholeWord' | 'regex'>,
): RegExp {
  const flags = query.caseSensitive ? 'g' : 'gi';
  try {
    if (query.regex) {
      const pattern = query.wholeWord ? `\\b(?:${query.text})\\b` : query.text;
      return new RegExp(pattern, flags);
    }
    const body = escapeRegex(query.text);
    const pattern = query.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
    return new RegExp(pattern, `${flags}u`);
  } catch (cause) {
    throw new MelinnaError('SEARCH_REGEX_INVALID', {
      userMessage: `Expressão regular inválida${cause instanceof Error ? `: ${cause.message.replace(/^Invalid regular expression: /, '')}` : '.'}`,
      cause,
    });
  }
}

/** Máscara de arquivo (`*`, `**`, `?`, `{a,b}`) para expressão regular sobre caminho com `/`. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i] as string;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else out += '.*';
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '{') {
      braces++;
      out += '(?:';
    } else if (ch === '}' && braces > 0) {
      braces--;
      out += ')';
    } else if (ch === ',' && braces > 0) out += '|';
    else out += escapeRegex(ch);
  }
  return new RegExp(`^${out}$`, 'i');
}

/** Cada máscara casa o caminho relativo inteiro, o de uma pasta acima dele ou, sem `/`, o nome. */
class Masks {
  private readonly patterns: { re: RegExp; hasSlash: boolean }[];

  constructor(spec: string | undefined) {
    this.patterns = (spec ?? '')
      .split(',')
      .map((p) => p.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
      .filter((p) => p !== '')
      .map((p) => ({ re: globToRegExp(p), hasSlash: p.includes('/') }));
  }

  get empty(): boolean {
    return this.patterns.length === 0;
  }

  matches(rel: string, name: string): boolean {
    const parts = rel.split('/');
    return this.patterns.some(({ re, hasSlash }) => {
      if (!hasSlash) return parts.some((part) => re.test(part)) || re.test(name);
      return parts.some((_, i) => re.test(parts.slice(0, i + 1).join('/')));
    });
  }
}

/** Texto do arquivo, ou `null` quando é binário: UTF-8 (com ou sem BOM) e UTF-16 com BOM; o resto não é texto. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (looksBinary(bytes)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

function previewOf(
  line: string,
  start: number,
  end: number,
): { preview: string; start: number; end: number } {
  if (line.length <= SEARCH_MAX_PREVIEW) return { preview: line, start, end };
  const from = Math.max(0, Math.min(start - 40, line.length - SEARCH_MAX_PREVIEW));
  const cut = line.slice(from, from + SEARCH_MAX_PREVIEW);
  return { preview: cut, start: start - from, end: Math.min(end - from, cut.length) };
}

/**
 * Busca no projeto: percorre as raízes sem seguir links, lê só texto de até 2 MB, e casa linha a linha.
 * Para no resultado {@link SEARCH_MAX_HITS} (`truncated`). Usa a porta de sistema de arquivos do núcleo,
 * sem processo externo; quem corta uma expressão regular lenta é o worker que a executa.
 */
export async function searchProject(
  deps: SearchDeps,
  query: ProjectSearchQuery,
  control: SearchControl = {},
): Promise<ProjectSearchResult> {
  const result: ProjectSearchResult = { hits: [], truncated: false, scannedFiles: 0, skipped: 0 };
  if (query.text === '') return result;
  const matcher = buildMatcher(query);
  const include = new Masks(query.include);
  const exclude = new Masks(query.exclude);
  const p = pathModule(deps.os);
  const { fs } = deps;

  const checkControl = () => {
    if (control.isCancelled?.()) throw new MelinnaError('SEARCH_CANCELLED');
    if (control.deadline && control.deadline.now() > control.deadline.at)
      throw new MelinnaError('SEARCH_TIMEOUT');
  };

  const searchFile = (path: string, text: string): boolean => {
    const lines = text.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      matcher.lastIndex = 0;
      for (let m = matcher.exec(line); m !== null; m = matcher.exec(line)) {
        if (m[0] === '') {
          matcher.lastIndex++;
          continue;
        }
        const shown = previewOf(line, m.index, m.index + m[0].length);
        result.hits.push({
          path,
          line: i + 1,
          column: m.index + 1,
          preview: shown.preview,
          matchStart: shown.start,
          matchEnd: shown.end,
        });
        if (result.hits.length >= SEARCH_MAX_HITS) {
          result.truncated = true;
          return false;
        }
      }
    }
    return true;
  };

  const walk = async (dir: string, rel: string): Promise<boolean> => {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      result.skipped++;
      return true;
    }
    for (const name of [...names].sort(naturalCompare)) {
      checkControl();
      const abs = p.join(dir, name);
      const relPath = rel === '' ? name : `${rel}/${name}`;
      let st;
      try {
        st = await fs.lstat(abs);
      } catch {
        continue;
      }
      if (st.isSymbolicLink) continue;
      if (st.isDirectory) {
        if (SEARCH_SKIP_DIRS.has(name) || exclude.matches(relPath, name)) continue;
        if (!(await walk(abs, relPath))) return false;
        continue;
      }
      if (!st.isFile || st.size > SEARCH_MAX_FILE_BYTES) continue;
      if (!include.empty && !include.matches(relPath, name)) continue;
      if (!exclude.empty && exclude.matches(relPath, name)) continue;
      let bytes: Uint8Array;
      try {
        bytes = await fs.readFile(abs);
      } catch {
        result.skipped++;
        continue;
      }
      result.scannedFiles++;
      const text = decodeText(bytes);
      if (text === null) continue;
      if (!searchFile(abs, text)) return false;
    }
    return true;
  };

  for (const root of query.roots) {
    checkControl();
    if (!(await walk(root, ''))) break;
  }
  return result;
}
