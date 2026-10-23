import { describe, expect, it } from 'vitest';
import {
  buildLaunchArgs,
  CMDLINE_TOO_LONG_MESSAGE,
  POSIX_ARGS_LIMIT,
  WINDOWS_CMDLINE_LIMIT,
} from '../../../../src/core/catalog/launch-plan';
import type { AgentDefinition } from '../../../../src/core/catalog/schema';

const base: AgentDefinition = {
  id: 'ag',
  displayName: 'Agente',
  kind: 'agent',
  executable: { command: 'ag' },
  args: ['--fixed'],
  prompt: { delivery: 'argument', args: ['{prompt}'] },
  model: {
    options: [{ id: 'm1', label: 'M1' }],
    default: 'm1',
    allowCustom: false,
    args: ['--model', '{model}'],
    switch: { strategy: 'unsupported' },
  },
  detect: { strategy: 'path' },
};

const repeat: AgentDefinition = { ...base, extraDirs: { style: 'repeat', args: ['--add-dir', '{dir}'] } };
const join: AgentDefinition = {
  ...base,
  extraDirs: { style: 'join', separator: ',', args: ['--include-directories', '{dirs}'] },
};

const linux = { os: 'linux' as const, file: '/usr/bin/ag' };
const sel = (extraDirs?: string[], prompt = '') => ({
  model: null,
  permission: null,
  prompt,
  ...(extraDirs === undefined ? {} : { extraDirs }),
});

describe('buildLaunchArgs — pastas extras', () => {
  it('repeat: one option per folder, each folder its own argument, before the other options', () => {
    const plan = buildLaunchArgs(repeat, sel(['/a', '/b'], 'faça X'), linux);
    expect(plan.args).toEqual(['--fixed', '--add-dir', '/a', '--add-dir', '/b', '--model', 'm1', 'faça X']);
    expect(plan.extraDirsApplied).toBe(true);
    expect(plan.extraDirsOmitted).toBe(0);
  });

  it('join: a single option with the folders joined by the separator', () => {
    const plan = buildLaunchArgs(join, sel(['/a', '/b']), linux);
    expect(plan.args).toEqual(['--fixed', '--include-directories', '/a,/b', '--model', 'm1']);
    expect(plan.extraDirsApplied).toBe(true);
  });

  it('keeps paths with spaces, accents and shell characters in a single argument', () => {
    const dirs = ['/meus projetos/ação', '/a b/c;rm -rf', '/x "y"'];
    const plan = buildLaunchArgs(repeat, sel(dirs), linux);
    expect(plan.args.filter((a) => dirs.includes(a))).toEqual(dirs);
    expect(plan.args).toHaveLength(base.args.length + dirs.length * 2 + 2);
  });

  it('puts the folders after the real target when the launcher is a shim (prefixArgs)', () => {
    const plan = buildLaunchArgs(repeat, sel(['C:\\p\\a']), {
      os: 'win32',
      file: 'C:\\node.exe',
      prefixArgs: ['C:\\npm\\cli.js'],
    });
    expect(plan.args.slice(0, 4)).toEqual(['C:\\npm\\cli.js', '--fixed', '--add-dir', 'C:\\p\\a']);
  });

  it('join: omits a folder whose path contains the separator and reports it', () => {
    const plan = buildLaunchArgs(join, sel(['/a', '/b,c', '/d']), linux);
    expect(plan.args).toContain('/a,/d');
    expect(plan.args).not.toContain('/b,c');
    expect(plan.extraDirsOmitted).toBe(1);
    expect(plan.extraDirsApplied).toBe(true);
  });

  it('join: when every folder has the separator nothing is passed', () => {
    const plan = buildLaunchArgs(join, sel(['/b,c']), linux);
    expect(plan.args).toEqual(['--fixed', '--model', 'm1']);
    expect(plan.extraDirsApplied).toBe(false);
    expect(plan.extraDirsOmitted).toBe(1);
  });

  it('an agent without extraDirs ignores the folders and reports not applied', () => {
    const plan = buildLaunchArgs(base, sel(['/a', '/b']), linux);
    expect(plan.args).toEqual(['--fixed', '--model', 'm1']);
    expect(plan.extraDirsApplied).toBe(false);
    expect(plan.extraDirsOmitted).toBe(0);
  });

  it('an empty list adds no arguments', () => {
    for (const list of [[], undefined]) {
      const plan = buildLaunchArgs(repeat, sel(list), linux);
      expect(plan.args).toEqual(['--fixed', '--model', 'm1']);
      expect(plan.extraDirsApplied).toBe(false);
    }
  });

  it('refuses a command line over the Windows limit', () => {
    const dirs = Array.from({ length: 40 }, (_, i) => `C:\\${'p'.repeat(400)}${i}`);
    expect(() => buildLaunchArgs(repeat, sel(dirs), { os: 'win32', file: 'C:\\ag.exe' })).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID', userMessage: CMDLINE_TOO_LONG_MESSAGE }),
    );
    expect(WINDOWS_CMDLINE_LIMIT).toBe(30_000);
  });

  it('refuses a command line over the Linux limit and accepts one just under it', () => {
    const big = (n: number) => Array.from({ length: n }, (_, i) => `/${'p'.repeat(1000)}${i}`);
    expect(() => buildLaunchArgs(repeat, sel(big(140)), linux)).toThrow(
      expect.objectContaining({ code: 'INPUT_INVALID', userMessage: CMDLINE_TOO_LONG_MESSAGE }),
    );
    expect(buildLaunchArgs(repeat, sel(big(20)), linux).extraDirsApplied).toBe(true);
    expect(POSIX_ARGS_LIMIT).toBe(131_072);
  });

  it('moves the prompt to the PTY on Windows when only the prompt pushes the line over the limit', () => {
    const plan = buildLaunchArgs(repeat, sel(['C:\\a'], 'x'.repeat(WINDOWS_CMDLINE_LIMIT)), {
      os: 'win32',
      file: 'C:\\ag.exe',
    });
    expect(plan.promptViaPty).toBeDefined();
    expect(plan.args).toContain('C:\\a');
  });
});
