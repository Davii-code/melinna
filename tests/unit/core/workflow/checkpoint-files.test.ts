import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  existsSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentCheckpointFiles } from '../../../../src/adapters/checkpoint-files';
import { JsonWorkflowStore } from '../../../../src/adapters/workflow-store';
import { emptyWorkflow } from '../../../../src/core/workflow/types';
import { createTempRepo } from '../../../support/git-fixture';
import { removeDirRecursive } from '../../../support/temp-dirs';
const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) removeDirRecursive(path);
});
function setup() {
  const temp = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-checkpoints-')));
  paths.push(temp);
  const project = join(temp, 'project'),
    data = join(temp, 'storage');
  mkdirSync(project);
  mkdirSync(data);
  return { project, data, files: new ContentCheckpointFiles(data) };
}
describe('content-addressed checkpoints', () => {
  it('preserves pre-existing edits and untracked files when undoing later changes, without touching ignored secrets', async () => {
    const repo = createTempRepo({ files: { 'code.txt': 'committed\n', '.gitignore': '.env\n' } });
    paths.push(repo.baseDir);
    const f = setup();
    writeFileSync(join(repo.root, 'code.txt'), 'user edit before agent\n');
    writeFileSync(join(repo.root, 'notes.txt'), 'user notes');
    writeFileSync(join(repo.root, '.env'), 'before-secret');
    const checkpoint = await f.files.capture([repo.root]);
    writeFileSync(join(repo.root, 'code.txt'), 'agent edit\n');
    writeFileSync(join(repo.root, 'new.txt'), 'agent file');
    writeFileSync(join(repo.root, '.env'), 'new-secret');
    const safety = await f.files.capture([repo.root]);
    expect(f.files.compare(checkpoint, safety).map((c) => c.path)).toEqual(['code.txt', 'new.txt']);
    await f.files.restore(checkpoint, safety);
    expect(readFileSync(join(repo.root, 'code.txt'), 'utf8')).toBe('user edit before agent\n');
    expect(readFileSync(join(repo.root, 'notes.txt'), 'utf8')).toBe('user notes');
    expect(existsSync(join(repo.root, 'new.txt'))).toBe(false);
    expect(readFileSync(join(repo.root, '.env'), 'utf8')).toBe('new-secret');
    expect(repo.head()).toBeTruthy();
  }, 20000);
  it('rejects a stale preview before changing any file', async () => {
    const f = setup();
    writeFileSync(join(f.project, 'a.txt'), 'initial');
    const target = await f.files.capture([f.project]);
    writeFileSync(join(f.project, 'a.txt'), 'agent');
    const expected = await f.files.capture([f.project]);
    writeFileSync(join(f.project, 'a.txt'), 'new user edit');
    await expect(f.files.restore(target, expected)).rejects.toThrow(/mudaram desde a prévia/);
    expect(readFileSync(join(f.project, 'a.txt'), 'utf8')).toBe('new user edit');
  });
  it('captures multiple folders and deduplicates nested roots', async () => {
    const f = setup();
    const second = join(f.project, 'nested');
    mkdirSync(second);
    writeFileSync(join(second, 'a.txt'), 'a');
    const capture = await f.files.capture([f.project, second]);
    expect(capture.folders).toHaveLength(1);
    expect(capture.folders[0]?.files[0]?.path).toBe('nested/a.txt');
    const extra = join(f.data, '..', 'extra');
    mkdirSync(extra);
    writeFileSync(join(extra, 'b.txt'), 'b');
    const both = await f.files.capture([f.project, extra]);
    writeFileSync(join(extra, 'b.txt'), 'changed');
    const expected = await f.files.capture([f.project, extra]);
    await f.files.restore(both, expected);
    expect(readFileSync(join(extra, 'b.txt'), 'utf8')).toBe('b');
  });
  it('refuses symlink traversal and never captures the application storage', async () => {
    const f = setup();
    const outside = join(f.data, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'private.txt'), 'private');
    symlinkSync(outside, join(f.project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.files.capture([f.project])).rejects.toThrow(/links simbólicos/i);
    await expect(f.files.capture([f.data])).rejects.toThrow(/dados do Melinna/);
  });
  it('detects corrupted snapshot content before overwriting the current file', async () => {
    const f = setup();
    writeFileSync(join(f.project, 'a.txt'), 'initial');
    const target = await f.files.capture([f.project]);
    writeFileSync(join(f.project, 'a.txt'), 'current');
    const expected = await f.files.capture([f.project]);
    const file = target.folders[0]?.files[0];
    if (!file) throw new Error('file');
    writeFileSync(join(f.data, 'blobs', file.hash.slice(0, 2), file.hash), 'corrupt');
    await expect(f.files.restore(target, expected)).rejects.toThrow(/corrompido/);
    expect(readFileSync(join(f.project, 'a.txt'), 'utf8')).toBe('current');
  });
  it('reviews additions, binary edits and deletions against captured bytes', async () => {
    const f = setup();
    writeFileSync(join(f.project, 'a.txt'), 'before\n');
    writeFileSync(join(f.project, 'image.bin'), Buffer.from([0, 1]));
    const base = await f.files.capture([f.project]);
    writeFileSync(join(f.project, 'a.txt'), 'after\n');
    writeFileSync(join(f.project, 'image.bin'), Buffer.from([0, 2, 3]));
    const current = await f.files.inspect([f.project]);
    const changes = f.files.compare(base, current);
    const text = changes.find((c) => c.path === 'a.txt'),
      binary = changes.find((c) => c.path === 'image.bin');
    if (!text || !binary) throw new Error('changes');
    expect((await f.files.diff(text)).hunks.length).toBeGreaterThan(0);
    expect((await f.files.diff(binary)).binary).toEqual({ oldSize: 2, newSize: 3 });
  });
  it('retains invalid workflow metadata instead of silently replacing it', async () => {
    const f = setup();
    const file = join(f.data, 'state.json'),
      store = new JsonWorkflowStore(file);
    await store.save(emptyWorkflow());
    expect(await store.load()).toEqual(emptyWorkflow());
    writeFileSync(file, '{broken');
    await expect(store.load()).rejects.toThrow(/original foi preservado/);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });
});
