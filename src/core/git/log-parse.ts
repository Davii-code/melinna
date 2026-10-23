import type { Commit, CommitFile } from './git-types';

/** Formato de `git log -z --name-status -M`: `\x1e` abre o registro, `\x1f` separa os campos e fecha o corpo. */
export const LOG_FORMAT = '%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1f';

const KINDS: Record<string, CommitFile['kind']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
};

/** Lê as linhas de `--name-status -z`: `M<NUL>caminho<NUL>` ou `R100<NUL>antigo<NUL>novo<NUL>`. */
export function parseNameStatus(tail: string): CommitFile[] {
  const tokens = tail.split('\0').filter((t) => t.length > 0 && t !== '\n');
  const files: CommitFile[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const status = tokens[i]!.replace(/^\n/, '');
    const kind = KINDS[status[0] ?? ''];
    if (!kind) continue;
    if (kind === 'renamed' || kind === 'copied') {
      const oldPath = tokens[++i];
      const path = tokens[++i];
      if (oldPath !== undefined && path !== undefined) files.push({ path, oldPath, kind });
    } else {
      const path = tokens[++i];
      if (path !== undefined) files.push({ path, kind });
    }
  }
  return files;
}

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const raw of out.split('\x1e')) {
    if (raw.trim().length === 0) continue;
    const fields = raw.split('\x1f');
    if (fields.length < 8) continue;
    const [sha, shortSha, author, email, date, subject, body] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({
      sha,
      shortSha,
      author,
      email,
      date,
      subject,
      body: body.trim(),
      files: parseNameStatus(fields.slice(7).join('\x1f')),
    });
  }
  return commits;
}

/** Nome antigo de `path` quando o commit o renomeou (saída de `diff-tree --name-status -z`), senão `null`. */
export function renamedFrom(nameStatus: string, path: string): string | null {
  const file = parseNameStatus(nameStatus).find((f) => f.path === path && f.kind === 'renamed');
  return file?.oldPath ?? null;
}
