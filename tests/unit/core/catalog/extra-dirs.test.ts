import { describe, expect, it } from 'vitest';
import { validateCatalog } from '../../../../src/core/catalog/validate';

function agent(extraDirs: unknown): Record<string, unknown> {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    kind: 'agent',
    executable: { command: 'claude' },
    args: [],
    prompt: { delivery: 'argument', args: ['{prompt}'] },
    detect: { strategy: 'path' },
    ...(extraDirs === undefined ? {} : { extraDirs }),
  };
}

function load(extraDirs: unknown) {
  return validateCatalog({ schemaVersion: 1, agents: [agent(extraDirs)] }, 'user');
}

describe('catalog extraDirs', () => {
  it('accepts an agent without extraDirs', () => {
    const r = load(undefined);
    expect(r.invalid).toEqual([]);
    expect(r.agents[0]?.extraDirs).toBeUndefined();
  });

  it('accepts the repeat style with {dir} once', () => {
    const r = load({ style: 'repeat', args: ['--add-dir', '{dir}'] });
    expect(r.invalid).toEqual([]);
    expect(r.agents[0]?.extraDirs).toEqual({ style: 'repeat', args: ['--add-dir', '{dir}'] });
  });

  it('accepts the join style with {dirs} once and a separator', () => {
    const r = load({ style: 'join', separator: ',', args: ['--include-directories', '{dirs}'] });
    expect(r.invalid).toEqual([]);
    expect(r.agents[0]?.extraDirs).toEqual({
      style: 'join',
      separator: ',',
      args: ['--include-directories', '{dirs}'],
    });
  });

  it.each([
    ['repeat without {dir}', { style: 'repeat', args: ['--add-dir'] }, 'exatamente uma vez'],
    ['repeat with {dir} twice', { style: 'repeat', args: ['{dir}', '{dir}'] }, 'exatamente uma vez'],
    ['repeat with {dirs}', { style: 'repeat', args: ['{dirs}'] }, 'não é permitido'],
    ['repeat with {dir} inside an argument', { style: 'repeat', args: ['--add-dir={dir}'] }, 'argumento inteiro'],
    ['join without {dirs}', { style: 'join', separator: ',', args: ['--x'] }, 'exatamente uma vez'],
    ['join with {dirs} twice', { style: 'join', separator: ',', args: ['{dirs}', '{dirs}'] }, 'exatamente uma vez'],
    ['join with an empty separator', { style: 'join', separator: '', args: ['{dirs}'] }, 'separator'],
    ['join without a separator', { style: 'join', args: ['{dirs}'] }, 'separator'],
    ['join with {dir}', { style: 'join', separator: ',', args: ['{dir}'] }, 'não é permitido'],
    ['unknown style', { style: 'env', args: [] }, 'style'],
    ['not an object', 'repeat', 'inválido'],
  ])('refuses %s', (_name, extraDirs, reason) => {
    const r = load(extraDirs);
    expect(r.agents).toEqual([]);
    expect(r.invalid).toHaveLength(1);
    expect(r.invalid[0]).toMatchObject({ source: 'user', id: 'claude' });
    expect(r.invalid[0]?.reason).toContain(reason);
  });
});
