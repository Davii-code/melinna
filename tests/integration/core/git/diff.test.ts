import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeFileSystem } from '../../../../src/adapters/node-fs';
import { NodeProcessRunner } from '../../../../src/adapters/node-process-runner';
import { diffWorktree } from '../../../../src/core/git/diff';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { createTempRepo, git, type TempRepo } from '../../../support/git-fixture';
import { currentOs } from '../../../support/os';

let repo: TempRepo;
let wt: string;
let base: string;

const PNG_OLD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 0, 0]);
const PNG_NEW = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9, 9, 0, 0, 7]);

beforeEach(() => {
  repo = createTempRepo({
    files: {
      'modificado-commit.txt': 'a\nb\nc\n',
      'stage.txt': 'um\n',
      'fora-de-stage.txt': 'x\ny\n',
      'apagado.txt': 'adeus\n',
      'renomear.txt': 'conteúdo grande o bastante para detectar renomeação\nlinha 2\nlinha 3\n',
      'imagem.png': PNG_OLD,
    },
  });
  base = repo.head();
  wt = join(repo.baseDir, 'wt');
  git(repo.root, ['worktree', 'add', '-q', '-b', 'melinna/diff/fake', wt, base]);
});

afterEach(() => {
  repo.cleanup();
});

function indexHash(): string {
  const p = resolve(wt, git(wt, ['rev-parse', '--git-path', 'index']).trim());
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}

function service() {
  const log = new MemoryLogger();
  return { git: new GitRunner(new NodeProcessRunner(), log), fs: new NodeFileSystem(), os: currentOs, log };
}

describe('diffWorktree', () => {
  it('reports the seven kinds of change against the base commit without touching the index', async () => {
    // commit do agente: novo arquivo e modificação
    writeFileSync(join(wt, 'novo-commit.txt'), 'novo\n');
    writeFileSync(join(wt, 'modificado-commit.txt'), 'a\nB\nc\n');
    git(wt, ['add', '-A']);
    git(wt, ['commit', '-q', '-m', 'agente']);
    // em stage
    writeFileSync(join(wt, 'stage.txt'), 'um\ndois\n');
    git(wt, ['add', 'stage.txt']);
    // fora de stage, apagado, renomeado, binário, não rastreado
    writeFileSync(join(wt, 'fora-de-stage.txt'), 'x\nY\n');
    rmSync(join(wt, 'apagado.txt'));
    git(wt, ['mv', 'renomear.txt', 'renomeado.txt']);
    writeFileSync(join(wt, 'imagem.png'), PNG_NEW);
    writeFileSync(join(wt, 'solto com espaço.txt'), 'não rastreado\n');
    const before = indexHash();

    const result = await diffWorktree(service(), { worktreePath: wt, baseCommit: base });
    const byPath = new Map(result.files.map((f) => [f.path, f]));

    expect(byPath.get('novo-commit.txt')?.change).toBe('added');
    expect(byPath.get('modificado-commit.txt')?.change).toBe('modified');
    expect(byPath.get('stage.txt')?.hunks[0]?.lines.some((l) => l.kind === 'add' && l.text === 'dois')).toBe(true);
    expect(byPath.get('fora-de-stage.txt')?.change).toBe('modified');
    expect(byPath.get('apagado.txt')?.change).toBe('deleted');
    expect(byPath.get('renomeado.txt')).toMatchObject({ change: 'renamed', oldPath: 'renomear.txt' });
    expect(byPath.get('imagem.png')).toMatchObject({
      change: 'modified',
      binary: { oldSize: PNG_OLD.length, newSize: PNG_NEW.length },
      hunks: [],
    });
    const untracked = byPath.get('solto com espaço.txt');
    expect(untracked?.change).toBe('untracked');
    expect(untracked?.hunks[0]?.lines).toEqual([{ kind: 'add', text: 'não rastreado', oldNo: null, newNo: 1 }]);
    expect(indexHash()).toBe(before);
    expect(git(wt, ['status', '--porcelain'])).toContain('?? "solto com espa');
  });

  it('reports sizes of an added and a deleted binary', async () => {
    rmSync(join(wt, 'imagem.png'));
    writeFileSync(join(wt, 'outra.bin'), PNG_NEW);
    git(wt, ['add', '-A']);
    const result = await diffWorktree(service(), { worktreePath: wt, baseCommit: base });
    const byPath = new Map(result.files.map((f) => [f.path, f]));
    expect(byPath.get('imagem.png')).toMatchObject({
      change: 'deleted',
      binary: { oldSize: PNG_OLD.length, newSize: null },
    });
    expect(byPath.get('outra.bin')).toMatchObject({
      change: 'added',
      binary: { oldSize: null, newSize: PNG_NEW.length },
    });
  });

  it('returns no files for a clean worktree', async () => {
    expect(await diffWorktree(service(), { worktreePath: wt, baseCommit: base })).toEqual({ files: [] });
  });

  it('renamed-on-disk files without staging show as deleted plus untracked', async () => {
    renameSync(join(wt, 'renomear.txt'), join(wt, 'movido.txt'));
    const result = await diffWorktree(service(), { worktreePath: wt, baseCommit: base });
    expect(result.files.map((f) => [f.path, f.change]).sort()).toEqual([
      ['movido.txt', 'untracked'],
      ['renomear.txt', 'deleted'],
    ]);
  });
});
