import type { Change, ChangeKind } from './git-types';

export interface ParsedStatus {
  /** `null` = HEAD solto. */
  branch: string | null;
  /** Vazio em repositório sem commits. */
  head: string;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  changes: Change[];
}

function kindOf(x: string, y: string): ChangeKind {
  if (x === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (y === 'A') return 'added';
  return 'modified';
}

/** Divide em `count` campos por espaço; o último campo (o caminho) mantém os espaços que tiver. */
function splitFields(entry: string, count: number): string[] {
  const out: string[] = [];
  let start = 0;
  for (let n = 0; n < count; n++) {
    const space = entry.indexOf(' ', start);
    if (space < 0) break;
    out.push(entry.slice(start, space));
    start = space + 1;
  }
  out.push(entry.slice(start));
  return out;
}

/** Lê `git status --porcelain=v2 -z --branch --untracked-files=all`; entradas ignoradas (`!`) são descartadas. */
export function parseStatusV2(out: string): ParsedStatus {
  const result: ParsedStatus = { branch: null, head: '', upstream: null, ahead: null, behind: null, changes: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith('# ')) {
      const space = entry.indexOf(' ', 2);
      const key = entry.slice(2, space < 0 ? undefined : space);
      const value = space < 0 ? '' : entry.slice(space + 1);
      if (key === 'branch.oid') result.head = value === '(initial)' ? '' : value;
      else if (key === 'branch.head') result.branch = value === '(detached)' ? null : value;
      else if (key === 'branch.upstream') result.upstream = value;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          result.ahead = Number(m[1]);
          result.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = entry[0];
    if (type === '1') {
      // 1 XY sub mH mI mW hH hI path
      const f = splitFields(entry, 8);
      const xy = f[1] ?? '..';
      result.changes.push({
        path: f[8] ?? '',
        kind: kindOf(xy[0] ?? '.', xy[1] ?? '.'),
        indexChanged: xy[0] !== '.',
        worktreeChanged: xy[1] !== '.',
      });
    } else if (type === '2') {
      // 2 XY sub mH mI mW hH hI Xscore path, seguido de \0 e do caminho de origem
      const f = splitFields(entry, 9);
      const xy = f[1] ?? '..';
      const oldPath = parts[++i] ?? '';
      const copied = (f[8] ?? '').startsWith('C');
      result.changes.push({
        path: f[9] ?? '',
        ...(copied ? {} : { oldPath }),
        kind: copied ? 'added' : 'renamed',
        indexChanged: xy[0] !== '.',
        worktreeChanged: xy[1] !== '.',
      });
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = splitFields(entry, 10);
      result.changes.push({ path: f[10] ?? '', kind: 'conflict', indexChanged: true, worktreeChanged: true });
    } else if (type === '?') {
      result.changes.push({ path: entry.slice(2), kind: 'untracked', indexChanged: false, worktreeChanged: true });
    }
  }
  return result;
}
