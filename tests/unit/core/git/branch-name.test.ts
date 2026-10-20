import { describe, expect, it } from 'vitest';
import { branchNameFor, freeBranchName, slugify } from '../../../../src/core/git/branch-name';
import { GitRunner } from '../../../../src/core/git/git-runner';
import { MemoryLogger } from '../../../support/fakes/logger';
import { FakeProcessRunner, failed, ok } from '../../../support/fakes/process-runner';

describe('slugify', () => {
  it('removes accents and symbols', () => {
    expect(slugify('Corrigir a função de Ação!')).toBe('corrigir-a-funcao-de-acao');
    expect(slugify('  __Olá,   mundo++ ')).toBe('ola-mundo');
    expect(slugify('Ünïcödé çãõ')).toBe('unicode-cao');
  });

  it('caps at 40 characters without a trailing dash', () => {
    const s = slugify('a'.repeat(39) + ' bcd');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
    expect(s).toBe('a'.repeat(39));
    expect(slugify('x'.repeat(100))).toHaveLength(40);
  });

  it('falls back to tarefa', () => {
    expect(slugify('')).toBe('tarefa');
    expect(slugify('!!!')).toBe('tarefa');
    expect(slugify('日本語')).toBe('tarefa');
  });
});

describe('branch names', () => {
  it('follows melinna/<slug>/<agent>', () => {
    expect(branchNameFor('minha-tarefa', 'claude')).toBe('melinna/minha-tarefa/claude');
  });

  function gitWith(existing: string[], validFormat = true) {
    const runner = new FakeProcessRunner()
      .on((_f, args) => {
        const i = args.indexOf('check-ref-format');
        if (i < 0) return undefined;
        return validFormat ? ok(args[i + 2]) : failed(1);
      })
      .on((_f, args) => {
        const ref = args.find((a) => a.startsWith('refs/heads/'));
        if (!ref) return undefined;
        return existing.includes(ref.slice('refs/heads/'.length)) ? ok('sha') : failed(1);
      });
    return { runner, git: new GitRunner(runner, new MemoryLogger()) };
  }

  it('adds -2, -3 on collision and skips reserved names', async () => {
    const { git } = gitWith(['melinna/t/claude', 'melinna/t/claude-2']);
    expect(await freeBranchName(git, '/r', 'melinna/t/claude')).toBe('melinna/t/claude-3');
    expect(await freeBranchName(git, '/r', 'melinna/t/claude', new Set(['melinna/t/claude-3']))).toBe(
      'melinna/t/claude-4',
    );
    expect(await freeBranchName(git, '/r', 'melinna/t/codex')).toBe('melinna/t/codex');
  });

  it('validates with check-ref-format before use', async () => {
    const { git, runner } = gitWith([], false);
    await expect(freeBranchName(git, '/r', 'melinna/t/x')).rejects.toMatchObject({ code: 'BRANCH_INVALID' });
    expect(runner.calls[0]?.args).toContain('check-ref-format');
  });
});
