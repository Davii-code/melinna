import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../src/adapters/node-fs';
import { nodePlatform } from '../../src/adapters/node-platform';
import { searchProject } from '../../src/core/files/search';
import { removeDirRecursive } from '../support/temp-dirs';

const FILES = 20_000;
const BUDGET_MS = 2_000;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'melinna-search-perf-'));
  for (let d = 0; d < 200; d++) {
    const dir = join(root, `pasta${d}`);
    mkdirSync(dir);
    for (let f = 0; f < FILES / 200; f++) {
      const n = d * 100 + f;
      const body = n % 500 === 0 ? `linha comum\nalvo encontrado ${n}\n` : `linha comum ${n}\noutra linha\n`;
      writeFileSync(join(dir, `arquivo${f}.ts`), body);
    }
  }
}, 120_000);

afterAll(() => {
  removeDirRecursive(root);
});

describe('project search performance', () => {
  it('searches 20,000 files and returns the results in under 2 s', async () => {
    const start = performance.now();
    const result = await searchProject(
      { fs: new NodeFileSystem(), os: nodePlatform().os },
      { roots: [root], text: 'alvo encontrado', caseSensitive: false, wholeWord: false, regex: false },
    );
    const ms = performance.now() - start;
    expect(result.scannedFiles).toBe(FILES);
    expect(result.hits).toHaveLength(FILES / 500);
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});
