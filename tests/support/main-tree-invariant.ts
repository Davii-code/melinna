import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect } from 'vitest';
import { git } from './git-fixture';

export interface MainTreeSnapshot {
  head: string;
  branch: string;
  indexHash: string;
  files: Record<string, string>;
}

function hash(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function walk(root: string, dir: string, out: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    if (dir === root && name === '.git') continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(root, abs, out);
    else out[relative(root, abs).split('\\').join('/')] = hash(readFileSync(abs));
  }
}

export function snapshotMainTree(root: string): MainTreeSnapshot {
  const indexPath = join(root, '.git', 'index');
  const files: Record<string, string> = {};
  walk(root, root, files);
  return {
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    branch: git(root, ['symbolic-ref', '--short', 'HEAD']).trim(),
    indexHash: existsSync(indexPath) ? hash(readFileSync(indexPath)) : '',
    files,
  };
}

export function expectMainTreeUnchanged(root: string, before: MainTreeSnapshot): void {
  expect(snapshotMainTree(root)).toEqual(before);
}
