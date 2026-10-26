import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import {
  buildMatcher,
  decodeText,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_HITS,
  searchProject,
  type ProjectSearchQuery,
} from '../../../../src/core/files/search';
import { MemoryFileSystem } from '../../../support/fakes/file-system';

function rig(files: Record<string, string | Uint8Array>) {
  const fs = new MemoryFileSystem();
  for (const [path, data] of Object.entries(files)) fs.seed(path, data);
  return fs;
}

const query = (over: Partial<ProjectSearchQuery> = {}): ProjectSearchQuery => ({
  roots: ['/repo'],
  text: 'alfa',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  ...over,
});

async function search(fs: MemoryFileSystem, over: Partial<ProjectSearchQuery> = {}) {
  return searchProject({ fs, os: 'linux' }, query(over));
}

const where = (r: Awaited<ReturnType<typeof search>>) => r.hits.map((h) => `${h.path}:${h.line}:${h.column}`);

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

describe('searchProject — texto', () => {
  it('finds a text with line, column and the line as preview', async () => {
    const fs = rig({ '/repo/a.txt': 'um\ndois alfa tres\nalfa' });
    const r = await search(fs);
    expect(where(r)).toEqual(['/repo/a.txt:2:6', '/repo/a.txt:3:1']);
    expect(r.hits[0]).toMatchObject({ preview: 'dois alfa tres', matchStart: 5, matchEnd: 9 });
    expect(r.truncated).toBe(false);
    expect(r.scannedFiles).toBe(1);
  });

  it('lists several matches of the same line one by one', async () => {
    const r = await search(rig({ '/repo/a.txt': 'alfa alfa' }));
    expect(r.hits.map((h) => h.column)).toEqual([1, 6]);
  });

  it('ignores case by default and respects it when asked', async () => {
    const fs = rig({ '/repo/a.txt': 'Alfa\nALFA\nalfa' });
    expect((await search(fs)).hits).toHaveLength(3);
    expect((await search(fs, { caseSensitive: true })).hits.map((h) => h.line)).toEqual([3]);
  });

  it('matches whole words only, treating accents and digits as word characters', async () => {
    const fs = rig({ '/repo/a.txt': 'alfa\nalfabeto\nsub_alfa\nalfa1\n(alfa)\nalfá\nalfa-beta' });
    const r = await search(fs, { wholeWord: true });
    expect(r.hits.map((h) => h.line)).toEqual([1, 5, 7]);
  });

  it('treats the text literally when it is not a regular expression', async () => {
    const fs = rig({ '/repo/a.txt': 'a.b\naxb\n(x)\n[y]' });
    expect((await search(fs, { text: 'a.b' })).hits.map((h) => h.line)).toEqual([1]);
    expect((await search(fs, { text: '(x)' })).hits.map((h) => h.line)).toEqual([3]);
    expect((await search(fs, { text: '[y]' })).hits.map((h) => h.line)).toEqual([4]);
  });

  it('searches with a regular expression, per line', async () => {
    const fs = rig({ '/repo/a.txt': 'axb\naab\nfim' });
    const r = await search(fs, { text: 'a+b$', regex: true });
    expect(r.hits.map((h) => [h.line, h.column])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    const word = await search(fs, { text: 'a.b', regex: true, wholeWord: true });
    expect(word.hits.map((h) => h.line)).toEqual([1]);
  });

  it('skips empty matches of a regular expression', async () => {
    const r = await search(rig({ '/repo/a.txt': 'bbb' }), { text: 'a*', regex: true });
    expect(r.hits).toEqual([]);
  });

  it('splits lines at CRLF, LF and lone CR', async () => {
    const r = await search(rig({ '/repo/a.txt': 'x\r\nalfa\r\ny\ralfa\nalfa' }));
    expect(r.hits.map((h) => h.line)).toEqual([2, 4, 5]);
  });

  it('returns nothing for an empty text', async () => {
    expect((await search(rig({ '/repo/a.txt': 'x' }), { text: '' })).hits).toEqual([]);
  });

  it('cuts a very long line around the match, keeping the positions right', async () => {
    const line = `${'x'.repeat(1000)}alfa${'y'.repeat(1000)}`;
    const r = await search(rig({ '/repo/a.txt': line }));
    const hit = r.hits[0];
    expect(hit?.preview.length).toBeLessThanOrEqual(300);
    expect(hit?.preview.slice(hit.matchStart, hit.matchEnd)).toBe('alfa');
    expect(hit?.column).toBe(1001);
  });
});

describe('searchProject — arquivos e pastas', () => {
  it('walks the roots in order and directories in natural order', async () => {
    const fs = rig({
      '/repo/b/f10.txt': 'alfa',
      '/repo/b/f2.txt': 'alfa',
      '/repo/a.txt': 'alfa',
      '/other/z.txt': 'alfa',
    });
    const r = await search(fs, { roots: ['/repo', '/other'] });
    expect(where(r)).toEqual([
      '/repo/a.txt:1:1',
      '/repo/b/f2.txt:1:1',
      '/repo/b/f10.txt:1:1',
      '/other/z.txt:1:1',
    ]);
  });

  it('leaves out .git, node_modules and the folders the explorer ignores', async () => {
    const files: Record<string, string> = { '/repo/src/ok.ts': 'alfa' };
    for (const dir of [
      '.git',
      'node_modules',
      'out',
      'dist',
      'coverage',
      'build',
      '.next',
      '.turbo',
      '.cache',
    ]) {
      files[`/repo/${dir}/x.txt`] = 'alfa';
      files[`/repo/src/${dir}/x.txt`] = 'alfa';
    }
    expect(where(await search(rig(files)))).toEqual(['/repo/src/ok.ts:1:1']);
  });

  it('skips binary files (null byte) and files over 2 MB', async () => {
    const fs = rig({
      '/repo/ok.txt': 'alfa',
      '/repo/bin.dat': new Uint8Array([97, 108, 102, 97, 0, 1, 2]),
      '/repo/big.txt': `alfa${'x'.repeat(SEARCH_MAX_FILE_BYTES)}`,
    });
    const r = await search(fs);
    expect(where(r)).toEqual(['/repo/ok.txt:1:1']);
  });

  it('treats other encodings as binary (invalid UTF-8)', async () => {
    const latin1 = new Uint8Array([97, 108, 102, 97, 0xe9]);
    const r = await search(rig({ '/repo/l.txt': latin1, '/repo/ok.txt': 'alfa' }));
    expect(where(r)).toEqual(['/repo/ok.txt:1:1']);
  });

  it('reads UTF-8 with and without BOM, and UTF-16 with BOM', async () => {
    const utf8 = new TextEncoder().encode('alfa utf8');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    const u16le = new Uint8Array([0xff, 0xfe, ...Buffer.from('um alfa', 'utf16le')]);
    const be = Buffer.from('dois alfa', 'utf16le');
    be.swap16();
    const u16be = new Uint8Array([0xfe, 0xff, ...be]);
    const r = await search(
      rig({ '/repo/1.txt': utf8, '/repo/2.txt': bom, '/repo/3.txt': u16le, '/repo/4.txt': u16be }),
    );
    expect(where(r)).toEqual(['/repo/1.txt:1:1', '/repo/2.txt:1:1', '/repo/3.txt:1:4', '/repo/4.txt:1:6']);
  });

  it('does not follow symbolic links or junctions', async () => {
    const fs = rig({ '/repo/ok.txt': 'alfa', '/fora/segredo.txt': 'alfa' });
    fs.seedLink('/repo/link', '/fora');
    fs.seedLink('/repo/arquivo-link.txt', '/fora/segredo.txt');
    const list = fs.readdir.bind(fs);
    fs.readdir = async (p: string) =>
      (await list(p)).includes('ok.txt') ? [...(await list(p)), 'link', 'arquivo-link.txt'] : list(p);
    expect(where(await search(fs))).toEqual(['/repo/ok.txt:1:1']);
  });

  it('skips a file it has no permission to read, and counts it', async () => {
    const fs = rig({ '/repo/a.txt': 'alfa', '/repo/b.txt': 'alfa', '/repo/c.txt': 'alfa' });
    fs.failOn('readFile', '/repo/b.txt', 'EACCES');
    const r = await search(fs);
    expect(where(r)).toEqual(['/repo/a.txt:1:1', '/repo/c.txt:1:1']);
    expect(r.skipped).toBe(1);
  });

  it('skips a folder it cannot list, and counts it', async () => {
    const fs = rig({ '/repo/a.txt': 'alfa', '/repo/sub/b.txt': 'alfa' });
    fs.failOn('readdir', '/repo/sub', 'EACCES');
    const r = await search(fs);
    expect(where(r)).toEqual(['/repo/a.txt:1:1']);
    expect(r.skipped).toBe(1);
  });

  it('survives a root that does not exist', async () => {
    const r = await search(rig({ '/repo/a.txt': 'alfa' }), { roots: ['/nada', '/repo'] });
    expect(where(r)).toEqual(['/repo/a.txt:1:1']);
  });
});

describe('searchProject — filtro de arquivos', () => {
  const files = {
    '/repo/src/a.ts': 'alfa',
    '/repo/src/b.tsx': 'alfa',
    '/repo/src/deep/c.ts': 'alfa',
    '/repo/docs/d.md': 'alfa',
    '/repo/README.md': 'alfa',
    '/repo/test/e.test.ts': 'alfa',
  };
  const names = async (over: Partial<ProjectSearchQuery>) =>
    (await search(rig(files), over)).hits.map((h) => h.path.replace('/repo/', ''));

  it('includes only the files that match a mask, by name anywhere', async () => {
    expect(await names({ include: '*.md' })).toEqual(['docs/d.md', 'README.md']);
  });

  it('accepts several masks separated by comma and braces', async () => {
    expect(await names({ include: '*.md, *.tsx' })).toEqual(['docs/d.md', 'README.md', 'src/b.tsx']);
    expect(await names({ include: '*.{md,tsx}' })).toEqual(['docs/d.md', 'README.md', 'src/b.tsx']);
  });

  it('masks with a slash match the path from the root', async () => {
    expect(await names({ include: 'src/**/*.ts' })).toEqual(['src/a.ts', 'src/deep/c.ts']);
    expect(await names({ include: 'docs/**' })).toEqual(['docs/d.md']);
  });

  it('excludes by mask, including whole folders', async () => {
    expect(await names({ exclude: 'docs, test' })).toEqual([
      'README.md',
      'src/a.ts',
      'src/b.tsx',
      'src/deep/c.ts',
    ]);
    expect(await names({ exclude: '*.test.ts, *.md' })).toEqual(['src/a.ts', 'src/b.tsx', 'src/deep/c.ts']);
  });

  it('combines include and exclude, exclude winning', async () => {
    expect(await names({ include: '*.ts', exclude: '*.test.ts' })).toEqual(['src/a.ts', 'src/deep/c.ts']);
  });

  it('ignores case in the masks and the leading "./"', async () => {
    expect(await names({ include: './SRC/**' })).toEqual(['src/a.ts', 'src/b.tsx', 'src/deep/c.ts']);
  });
});

describe('searchProject — limites, regex inválida e controle', () => {
  it('stops at 2,000 results and says the list was cut', async () => {
    const lines = Array.from({ length: SEARCH_MAX_HITS + 500 }, () => 'alfa').join('\n');
    const r = await search(rig({ '/repo/a.txt': lines, '/repo/b.txt': 'alfa' }));
    expect(r.hits).toHaveLength(SEARCH_MAX_HITS);
    expect(r.truncated).toBe(true);
    expect(r.hits.every((h) => h.path === '/repo/a.txt')).toBe(true);
  });

  it('does not mark as cut when it ends exactly at the limit', async () => {
    const lines = Array.from({ length: SEARCH_MAX_HITS - 1 }, () => 'alfa').join('\n');
    const r = await search(rig({ '/repo/a.txt': lines }));
    expect(r.hits).toHaveLength(SEARCH_MAX_HITS - 1);
    expect(r.truncated).toBe(false);
  });

  it('refuses an invalid regular expression without searching', async () => {
    const fs = rig({ '/repo/a.txt': 'alfa' });
    const err = await failure(search(fs, { text: '(abc', regex: true }));
    expect(err.code).toBe('SEARCH_REGEX_INVALID');
    expect(err.userMessage).toMatch(/^Expressão regular inválida/);
  });

  it('is cancelled between files', async () => {
    const fs = rig({ '/repo/a.txt': 'alfa', '/repo/b.txt': 'alfa' });
    let calls = 0;
    const err = await failure(
      searchProject({ fs, os: 'linux' }, query(), { isCancelled: () => ++calls > 2 }),
    );
    expect(err.code).toBe('SEARCH_CANCELLED');
  });

  it('stops with SEARCH_TIMEOUT when the deadline passes', async () => {
    const fs = rig({ '/repo/a.txt': 'alfa', '/repo/b.txt': 'alfa' });
    let now = 0;
    const err = await failure(
      searchProject({ fs, os: 'linux' }, query(), { deadline: { now: () => now++, at: 1 } }),
    );
    expect(err.code).toBe('SEARCH_TIMEOUT');
  });
});

describe('buildMatcher and decodeText', () => {
  it('builds a global matcher', () => {
    const re = buildMatcher({ text: 'a.b', caseSensitive: true, wholeWord: false, regex: false });
    expect(re.flags).toContain('g');
    expect(re.test('a.b')).toBe(true);
    re.lastIndex = 0;
    expect(re.test('axb')).toBe(false);
  });

  it('decodes text and refuses binary', () => {
    expect(decodeText(new TextEncoder().encode('olá'))).toBe('olá');
    expect(decodeText(new Uint8Array([1, 0, 2]))).toBeNull();
    expect(decodeText(new Uint8Array([0xe9]))).toBeNull();
    expect(decodeText(new Uint8Array([]))).toBe('');
  });
});
