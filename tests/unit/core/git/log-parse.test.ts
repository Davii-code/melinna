import { describe, expect, it } from 'vitest';
import { LOG_FORMAT, parseLog, parseNameStatus, renamedFrom } from '../../../../src/core/git/log-parse';

const RS = '\x1e';
const US = '\x1f';
const NUL = '\0';

function record(o: { sha: string; subject: string; body?: string; files?: string[] }): string {
  const head = [o.sha, o.sha.slice(0, 7), 'Ana Souza', 'ana@example.com', '2026-10-23T14:44:38-03:00', o.subject, o.body ?? ''];
  // com -z o git coloca "\0\n" entre o formato e as linhas de --name-status
  return `${RS}${head.join(US)}${US}${NUL}\n${(o.files ?? []).join(NUL)}${o.files?.length ? NUL : ''}`;
}

describe('parseLog', () => {
  it('uses the unit and record separators in the format', () => {
    expect(LOG_FORMAT).toContain('%x1e');
    expect(LOG_FORMAT).toContain('%x1f');
  });

  it('parses commits with author, date, subject and files', () => {
    const out =
      record({ sha: 'a'.repeat(40), subject: 'um', files: ['M', 'src/a.ts', 'A', 'src/b.ts', 'D', 'c.ts'] }) +
      record({ sha: 'b'.repeat(40), subject: 'dois', files: ['M', 'README.md'] });
    const commits = parseLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      author: 'Ana Souza',
      email: 'ana@example.com',
      date: '2026-10-23T14:44:38-03:00',
      subject: 'um',
      body: '',
      files: [
        { path: 'src/a.ts', kind: 'modified' },
        { path: 'src/b.ts', kind: 'added' },
        { path: 'c.ts', kind: 'deleted' },
      ],
    });
    expect(commits[1]?.subject).toBe('dois');
  });

  it('keeps a multi-line body, trimmed', () => {
    const out = record({ sha: 'c'.repeat(40), subject: 'assunto', body: 'linha 1\n\nlinha 3 com ação\n' });
    expect(parseLog(out)[0]?.body).toBe('linha 1\n\nlinha 3 com ação');
  });

  it('parses a renamed file with the old path', () => {
    const out = record({ sha: 'd'.repeat(40), subject: 'renomeia', files: ['R100', 'antigo.txt', 'novo.txt', 'A', 'x.txt'] });
    expect(parseLog(out)[0]?.files).toEqual([
      { path: 'novo.txt', oldPath: 'antigo.txt', kind: 'renamed' },
      { path: 'x.txt', kind: 'added' },
    ]);
  });

  it('accepts a commit without files (merge)', () => {
    const out = record({ sha: 'e'.repeat(40), subject: 'merge' }) + record({ sha: 'f'.repeat(40), subject: 'seguinte', files: ['M', 'a'] });
    const commits = parseLog(out);
    expect(commits[0]?.files).toEqual([]);
    expect(commits[1]?.files).toEqual([{ path: 'a', kind: 'modified' }]);
  });

  it('returns an empty list for empty output', () => {
    expect(parseLog('')).toEqual([]);
  });

  it('finds the old name of a renamed path in name-status output', () => {
    const out = ['R100', 'antigo.txt', 'novo.txt', 'M', 'x.txt', ''].join('\0');
    expect(parseNameStatus(out)).toEqual([
      { path: 'novo.txt', oldPath: 'antigo.txt', kind: 'renamed' },
      { path: 'x.txt', kind: 'modified' },
    ]);
    expect(renamedFrom(out, 'novo.txt')).toBe('antigo.txt');
    expect(renamedFrom(out, 'x.txt')).toBeNull();
    expect(renamedFrom('', 'qualquer')).toBeNull();
  });
});
