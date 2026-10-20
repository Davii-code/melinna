import { describe, expect, it } from 'vitest';
import { WINDOWS_CMDLINE_LIMIT, buildLaunchArgs } from '../../../../src/core/catalog/launch-plan';
import type { AgentDefinition } from '../../../../src/core/catalog/schema';
import { MelinnaError } from '../../../../src/core/errors';

const def: AgentDefinition = {
  id: 'claude',
  displayName: 'Claude',
  kind: 'agent',
  executable: { command: 'claude' },
  args: ['--fixed'],
  prompt: { delivery: 'argument', args: ['--prompt-interactive', '{prompt}'] },
  model: {
    options: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
    ],
    default: 'sonnet',
    allowCustom: true,
    args: ['--model', '{model}'],
    switch: { strategy: 'pty-command', template: '/model {model}\r' },
  },
  permission: {
    options: [
      { id: 'default', label: 'Perguntar', args: ['--permission-mode', 'default'] },
      { id: 'plan', label: 'Planejar', args: ['--permission-mode', '{permission}'] },
    ],
    default: 'default',
    switch: { strategy: 'restart-resume' },
  },
  resume: { args: ['--continue'] },
  detect: { strategy: 'path' },
};

const linux = { os: 'linux' as const, file: '/usr/bin/claude' };

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as MelinnaError).code;
  }
  return 'none';
}

describe('buildLaunchArgs', () => {
  it('orders args: fixed, permission, model, resume, prompt', () => {
    const plan = buildLaunchArgs(
      def,
      { model: 'opus', permission: 'plan', prompt: 'faça X', resume: true },
      {
        ...linux,
        prefixArgs: ['/shim/cli.js'],
      },
    );
    expect(plan.args).toEqual([
      '/shim/cli.js',
      '--fixed',
      '--permission-mode',
      'plan',
      '--model',
      'opus',
      '--continue',
      '--prompt-interactive',
      'faça X',
    ]);
    expect(plan.model).toBe('opus');
    expect(plan.permission).toBe('plan');
    expect(plan.promptViaPty).toBeUndefined();
  });

  it('uses defaults and keeps a prompt with spaces and quotes as a single argument', () => {
    const prompt = 'a "b" \'c\' {model} && rm -rf /';
    const plan = buildLaunchArgs(def, { model: null, permission: null, prompt }, linux);
    expect(plan.args.slice(-1)).toEqual([prompt]);
    expect(plan.args).toContain('sonnet');
    expect(plan.args.filter((a) => a === prompt)).toHaveLength(1);
  });

  it('validates custom models with the regex', () => {
    expect(buildLaunchArgs(def, { model: 'claude-x:1@a/b', permission: null, prompt: '' }, linux).model).toBe(
      'claude-x:1@a/b',
    );
    expect(code(() => buildLaunchArgs(def, { model: 'a b', permission: null, prompt: '' }, linux))).toBe(
      'INPUT_INVALID',
    );
    expect(code(() => buildLaunchArgs(def, { model: '--evil;', permission: null, prompt: '' }, linux))).toBe(
      'INPUT_INVALID',
    );
    const noCustom = { ...def, model: { ...def.model!, allowCustom: false } };
    expect(
      code(() => buildLaunchArgs(noCustom, { model: 'outro', permission: null, prompt: '' }, linux)),
    ).toBe('INPUT_INVALID');
  });

  it('rejects permission modes outside the list', () => {
    expect(code(() => buildLaunchArgs(def, { model: null, permission: 'yolo', prompt: '' }, linux))).toBe(
      'INPUT_INVALID',
    );
  });

  it('rejects prompts with NUL', () => {
    expect(code(() => buildLaunchArgs(def, { model: null, permission: null, prompt: 'a\0b' }, linux))).toBe(
      'PROMPT_INVALID',
    );
  });

  it('moves very long prompts to the PTY on Windows only', () => {
    const prompt = 'x'.repeat(WINDOWS_CMDLINE_LIMIT);
    const win = buildLaunchArgs(
      def,
      { model: null, permission: null, prompt },
      { os: 'win32', file: 'C:\\c.exe' },
    );
    expect(win.promptViaPty).toBe(prompt);
    expect(win.args).not.toContain('--prompt-interactive');
    const lin = buildLaunchArgs(def, { model: null, permission: null, prompt }, linux);
    expect(lin.promptViaPty).toBeUndefined();
    expect(lin.args).toContain(prompt);
  });

  it('delivers through the PTY when declared, and never for none', () => {
    const pty: AgentDefinition = { ...def, prompt: { delivery: 'pty' } };
    const p = buildLaunchArgs(pty, { model: null, permission: null, prompt: 'olá' }, linux);
    expect(p.promptViaPty).toBe('olá');
    expect(p.args).not.toContain('olá');
    const shell: AgentDefinition = {
      id: 'bash',
      displayName: 'Bash',
      kind: 'shell',
      executable: { command: 'bash' },
      args: ['-l'],
      prompt: { delivery: 'none' },
      detect: { strategy: 'path' },
    };
    const s = buildLaunchArgs(shell, { model: 'x', permission: 'y', prompt: 'ignored' }, linux);
    expect(s).toEqual({ args: ['-l'], model: null, permission: null });
  });

  it('omits the prompt arguments when the prompt is empty', () => {
    expect(buildLaunchArgs(def, { model: null, permission: null, prompt: '' }, linux).args).not.toContain(
      '--prompt-interactive',
    );
  });
});
