import type { DiffLine, FileChange, FileDiff, Hunk } from '../api-types';

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Desfaz as aspas C que o git usa em caminhos com caracteres especiais (escapes octais em UTF-8). */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const pushText = (s: string) => bytes.push(...new TextEncoder().encode(s));
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] ?? '';
    if (ch !== '\\') {
      pushText(ch);
      continue;
    }
    const next = body[i + 1] ?? '';
    if (/[0-7]/.test(next)) {
      const oct = body.slice(i + 1, i + 4);
      bytes.push(Number.parseInt(oct, 8));
      i += 3;
      continue;
    }
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', a: '\x07', b: '\b', f: '\f', v: '\v' };
    pushText(map[next] ?? next);
    i += 1;
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

/** Caminho de uma linha `--- a/x` / `+++ b/x`; `null` para /dev/null. */
function headerPath(rest: string): string | null {
  const value = rest.endsWith('\t') ? rest.slice(0, -1) : rest;
  if (value === '/dev/null') return null;
  const unq = unquoteGitPath(value);
  return unq.startsWith('a/') || unq.startsWith('b/') ? unq.slice(2) : unq;
}

/** Caminhos da linha `diff --git a/X b/Y`, para diffs sem `---`/`+++` (binários, renomeações puras). */
function gitLinePaths(rest: string): { a: string; b: string } | null {
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*"|\S.*)$/.exec(rest);
    if (!m) return null;
    return { a: headerPath(m[1] ?? '') ?? '', b: headerPath(m[2] ?? '') ?? '' };
  }
  // sem aspas, os dois caminhos são iguais quando não há renomeação: "a/P b/P"
  if ((rest.length - 5) % 2 === 0) {
    const len = (rest.length - 5) / 2;
    const a = rest.slice(2, 2 + len);
    const b = rest.slice(len + 5);
    if (rest.startsWith('a/') && rest.slice(2 + len, len + 5) === ' b/' && a === b) return { a, b };
  }
  const idx = rest.indexOf(' b/');
  if (!rest.startsWith('a/') || idx < 0) return null;
  return { a: rest.slice(2, idx), b: rest.slice(idx + 3) };
}

interface Builder {
  oldPath: string | null;
  newPath: string | null;
  gitPaths: { a: string; b: string } | null;
  added: boolean;
  deleted: boolean;
  renameFrom: string | null;
  renameTo: string | null;
  binary: boolean;
  hunks: Hunk[];
}

function finish(b: Builder): FileDiff {
  let change: FileChange = 'modified';
  if (b.renameFrom !== null) change = 'renamed';
  else if (b.added) change = 'added';
  else if (b.deleted) change = 'deleted';
  const path =
    b.renameTo ?? (b.deleted ? (b.oldPath ?? b.gitPaths?.a) : (b.newPath ?? b.gitPaths?.b)) ?? b.oldPath ?? '';
  const file: FileDiff = {
    path,
    change,
    hunks: b.hunks,
    lineCount: b.hunks.reduce((n, h) => n + h.lines.length, 0),
  };
  if (b.renameFrom !== null) file.oldPath = b.renameFrom;
  if (b.binary) file.binary = { oldSize: null, newSize: null };
  return file;
}

/** Interpreta a saída de `git diff` (formato unificado, sem cor) em arquivos e hunks com números de linha. */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let cur: Builder | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let lastKind: DiffLine['kind'] | null = null;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (cur) files.push(finish(cur));
      cur = {
        oldPath: null,
        newPath: null,
        gitPaths: gitLinePaths(line.slice('diff --git '.length)),
        added: false,
        deleted: false,
        renameFrom: null,
        renameTo: null,
        binary: false,
        hunks: [],
      };
      hunk = null;
      continue;
    }
    if (!cur) continue;
    if (hunk === null) {
      if (line.startsWith('new file mode')) cur.added = true;
      else if (line.startsWith('deleted file mode')) cur.deleted = true;
      else if (line.startsWith('rename from ')) cur.renameFrom = unquoteGitPath(line.slice('rename from '.length));
      else if (line.startsWith('rename to ')) cur.renameTo = unquoteGitPath(line.slice('rename to '.length));
      else if (line.startsWith('Binary files ')) {
        cur.binary = true;
        if (line.startsWith('Binary files /dev/null ')) cur.added = true;
        if (line.endsWith(' and /dev/null differ')) cur.deleted = true;
      } else if (line.startsWith('--- ')) {
        cur.oldPath = headerPath(line.slice(4));
        if (cur.oldPath === null) cur.added = true;
      } else if (line.startsWith('+++ ')) {
        cur.newPath = headerPath(line.slice(4));
        if (cur.newPath === null) cur.deleted = true;
      }
    }
    const m = HUNK_RE.exec(line);
    if (m && line.startsWith('@@')) {
      hunk = {
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      cur.hunks.push(hunk);
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      lastKind = null;
      continue;
    }
    if (!hunk) continue;
    const tag = line[0];
    const body = line.slice(1);
    if (tag === ' ') {
      hunk.lines.push({ kind: 'context', text: body, oldNo, newNo });
      oldNo += 1;
      newNo += 1;
      lastKind = 'context';
    } else if (tag === '-') {
      hunk.lines.push({ kind: 'del', text: body, oldNo, newNo: null });
      oldNo += 1;
      lastKind = 'del';
    } else if (tag === '+') {
      hunk.lines.push({ kind: 'add', text: body, oldNo: null, newNo });
      newNo += 1;
      lastKind = 'add';
    } else if (tag === '\\') {
      if (lastKind === 'del' || lastKind === 'context') hunk.noNewlineOld = true;
      if (lastKind === 'add' || lastKind === 'context') hunk.noNewlineNew = true;
    }
  }
  if (cur) files.push(finish(cur));
  return files;
}
