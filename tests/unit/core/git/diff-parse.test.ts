import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, unquoteGitPath } from '../../../../src/core/git/diff-parse';

const MODIFIED = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@ export function main() {',
  ' linha 1',
  '-linha 2',
  '+linha 2 nova',
  '+linha extra',
  ' linha 3',
  '@@ -10 +11 @@',
  '-fim',
  '+fim novo',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('parseUnifiedDiff', () => {
  it('parses a modified file with several hunks and line numbers', () => {
    const [f] = parseUnifiedDiff(MODIFIED);
    expect(f).toMatchObject({ path: 'src/app.ts', change: 'modified', lineCount: 7 });
    expect(f?.oldPath).toBeUndefined();
    expect(f?.hunks).toHaveLength(2);
    const h = f!.hunks[0]!;
    expect(h).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 });
    expect(h.header).toBe('@@ -1,3 +1,4 @@ export function main() {');
    expect(h.lines).toEqual([
      { kind: 'context', text: 'linha 1', oldNo: 1, newNo: 1 },
      { kind: 'del', text: 'linha 2', oldNo: 2, newNo: null },
      { kind: 'add', text: 'linha 2 nova', oldNo: null, newNo: 2 },
      { kind: 'add', text: 'linha extra', oldNo: null, newNo: 3 },
      { kind: 'context', text: 'linha 3', oldNo: 3, newNo: 4 },
    ]);
    const h2 = f!.hunks[1]!;
    expect(h2).toMatchObject({ oldStart: 10, oldLines: 1, newStart: 11, newLines: 1, noNewlineNew: true });
    expect(h2.noNewlineOld).toBeUndefined();
  });

  it('parses new, deleted and renamed files', () => {
    const text = [
      'diff --git a/novo.txt b/novo.txt',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/novo.txt',
      '@@ -0,0 +1,2 @@',
      '+a',
      '+b',
      'diff --git a/velho.txt b/velho.txt',
      'deleted file mode 100644',
      'index 4444444..0000000',
      '--- a/velho.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
      'diff --git a/de.txt b/para.txt',
      'similarity index 90%',
      'rename from de.txt',
      'rename to para.txt',
      'index 5555555..6666666 100644',
      '--- a/de.txt',
      '+++ b/para.txt',
      '@@ -1 +1 @@',
      '-um',
      '+dois',
      'diff --git a/so-nome.txt b/so-nome2.txt',
      'similarity index 100%',
      'rename from so-nome.txt',
      'rename to so-nome2.txt',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files.map((f) => [f.path, f.change, f.oldPath, f.lineCount])).toEqual([
      ['novo.txt', 'added', undefined, 2],
      ['velho.txt', 'deleted', undefined, 1],
      ['para.txt', 'renamed', 'de.txt', 2],
      ['so-nome2.txt', 'renamed', 'so-nome.txt', 0],
    ]);
    expect(files[1]?.hunks[0]?.lines[0]).toEqual({ kind: 'del', text: 'x', oldNo: 1, newNo: null });
  });

  it('marks binary files without hunks', () => {
    const text = [
      'diff --git a/img.png b/img.png',
      'index 7777777..8888888 100644',
      'Binary files a/img.png and b/img.png differ',
      'diff --git a/nova.bin b/nova.bin',
      'new file mode 100644',
      'index 0000000..9999999',
      'Binary files /dev/null and b/nova.bin differ',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(text);
    expect(files).toEqual([
      { path: 'img.png', change: 'modified', binary: { oldSize: null, newSize: null }, hunks: [], lineCount: 0 },
      { path: 'nova.bin', change: 'added', binary: { oldSize: null, newSize: null }, hunks: [], lineCount: 0 },
    ]);
  });

  it('handles paths with spaces, accents and quoting', () => {
    const text = [
      'diff --git a/pasta com espaço/ação.ts b/pasta com espaço/ação.ts',
      'index 1..2 100644',
      '--- a/pasta com espaço/ação.ts\t',
      '+++ b/pasta com espaço/ação.ts\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git "a/aspas\\"e\\\\barra.txt" "b/aspas\\"e\\\\barra.txt"',
      'index 3..4 100644',
      '--- "a/aspas\\"e\\\\barra.txt"',
      '+++ "b/aspas\\"e\\\\barra.txt"',
      '@@ -1 +1 @@',
      '-c',
      '+d',
      'diff --git a/bin com espaço.dat b/bin com espaço.dat',
      'index 5..6 100644',
      'Binary files a/bin com espaço.dat and b/bin com espaço.dat differ',
      '',
    ].join('\n');
    expect(parseUnifiedDiff(text).map((f) => f.path)).toEqual([
      'pasta com espaço/ação.ts',
      'aspas"e\\barra.txt',
      'bin com espaço.dat',
    ]);
  });

  it('keeps CRLF content and lines that look like headers inside hunks', () => {
    const text = [
      'diff --git a/w.txt b/w.txt',
      '--- a/w.txt',
      '+++ b/w.txt',
      '@@ -1,2 +1,2 @@',
      '---- não é cabeçalho',
      '++++ também não\r',
      ' contexto',
      '',
    ].join('\n');
    const [f] = parseUnifiedDiff(text);
    expect(f?.hunks[0]?.lines).toEqual([
      { kind: 'del', text: '--- não é cabeçalho', oldNo: 1, newNo: null },
      { kind: 'add', text: '+++ também não\r', oldNo: null, newNo: 1 },
      { kind: 'context', text: 'contexto', oldNo: 2, newNo: 2 },
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });
});

describe('unquoteGitPath', () => {
  it('decodes C-style quoting and octal UTF-8 escapes', () => {
    expect(unquoteGitPath('"caf\\303\\251.txt"')).toBe('café.txt');
    expect(unquoteGitPath('"tab\\there"')).toBe('tab\there');
    expect(unquoteGitPath('simples.txt')).toBe('simples.txt');
  });
});
