import { describe, expect, it } from 'vitest';
import { validateCatalog } from '../../../../src/core/catalog/validate';

function agent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    kind: 'agent',
    executable: { command: 'claude' },
    args: [],
    prompt: { delivery: 'argument', args: ['{prompt}'] },
    model: {
      options: [{ id: 'sonnet', label: 'Sonnet' }],
      default: 'sonnet',
      allowCustom: true,
      args: ['--model', '{model}'],
      switch: { strategy: 'pty-command', template: '/model {model}\r' },
    },
    permission: {
      options: [
        { id: 'default', label: 'Perguntar', args: ['--permission-mode', 'default'] },
        { id: 'yolo', label: 'Livre', args: ['--yolo'], dangerous: true },
      ],
      default: 'default',
      switch: { strategy: 'restart-resume' },
    },
    resume: { args: ['--continue'] },
    detect: { strategy: 'path' },
    ...over,
  };
}

function shell(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bash',
    displayName: 'Bash',
    kind: 'shell',
    platforms: ['linux', 'darwin'],
    executable: { command: 'bash' },
    args: ['-l'],
    prompt: { delivery: 'none' },
    detect: { strategy: 'path' },
    ...over,
  };
}

function reasons(entries: unknown[]): string[] {
  return validateCatalog({ schemaVersion: 1, agents: entries }, 'user').invalid.map((i) => i.reason);
}

describe('validateCatalog', () => {
  it('accepts a complete agent and a shell', () => {
    const r = validateCatalog({ schemaVersion: 1, agents: [agent(), shell()] }, 'builtin');
    expect(r.invalid).toEqual([]);
    expect(r.agents.map((a) => a.id)).toEqual(['claude', 'bash']);
    expect(r.agents[0]?.permission?.options[1]?.dangerous).toBe(true);
    expect(r.agents[1]?.platforms).toEqual(['linux', 'darwin']);
  });

  it('rejects missing required fields', () => {
    for (const field of ['displayName', 'kind', 'executable', 'args', 'prompt', 'detect']) {
      const a = Object.fromEntries(Object.entries(agent()).filter(([k]) => k !== field));
      expect(reasons([a])).toHaveLength(1);
    }
  });

  it('rejects invalid ids', () => {
    for (const id of ['Claude', '-x', '', 'a'.repeat(33), 'a_b']) {
      expect(reasons([agent({ id })])[0]).toBe('id inválido');
    }
  });

  it('rejects partial placeholders and placeholders out of place', () => {
    expect(reasons([agent({ prompt: { delivery: 'argument', args: ['--p={prompt}'] } })])[0]).toContain(
      'argumento inteiro',
    );
    expect(reasons([agent({ args: ['{model}'] })])[0]).toContain('não é permitido');
    expect(reasons([agent({ prompt: { delivery: 'argument', args: ['--x'] } })])[0]).toContain('{prompt}');
  });

  it('rejects restart-resume without resume', () => {
    const a = agent();
    delete a.resume;
    expect(reasons([a])[0]).toBe('restart-resume exige resume');
  });

  it('rejects shells with model, permission or a prompt', () => {
    expect(reasons([shell({ model: agent().model })])[0]).toBe('shell não pode ter model');
    expect(reasons([shell({ permission: agent().permission })])[0]).toBe('shell não pode ter permission');
    expect(reasons([shell({ prompt: { delivery: 'pty' } })])[0]).toBe('shell deve ter prompt.delivery none');
  });

  it('rejects defaults outside the option list', () => {
    const a = agent();
    (a.model as Record<string, unknown>).default = 'opus';
    expect(reasons([a])[0]).toBe('model.default fora da lista');
    const b = agent();
    (b.permission as Record<string, unknown>).default = 'nada';
    expect(reasons([b])[0]).toBe('permission.default fora da lista');
  });

  it('validates platforms', () => {
    expect(reasons([shell({ platforms: ['beos'] })])[0]).toBe('platforms inválido');
    expect(reasons([shell({ platforms: [] })])[0]).toBe('platforms inválido');
  });

  it('validates switch templates', () => {
    const a = agent();
    (a.model as Record<string, unknown>).switch = { strategy: 'pty-command', template: '/model\r' };
    expect(reasons([a])[0]).toContain('{model}');
    const b = agent();
    (b.model as Record<string, unknown>).switch = { strategy: 'magic' };
    expect(reasons([b])[0]).toContain('strategy inválida');
  });

  it('keeps valid entries when others are invalid and reports ids', () => {
    const r = validateCatalog(
      { schemaVersion: 1, agents: [agent({ id: 'BAD' }), shell(), agent({ kind: 'robot' })] },
      'user',
    );
    expect(r.agents.map((a) => a.id)).toEqual(['bash']);
    expect(r.invalid).toEqual([
      { source: 'user', id: 'BAD', reason: 'id inválido' },
      { source: 'user', id: 'claude', reason: 'kind deve ser agent ou shell' },
    ]);
  });

  it('rejects whole files with a wrong shape or schema version', () => {
    expect(validateCatalog([], 'user').invalid[0]?.reason).toContain('objeto');
    expect(validateCatalog({ schemaVersion: 2, agents: [] }, 'user').invalid[0]?.reason).toContain(
      'schemaVersion',
    );
    expect(validateCatalog({ schemaVersion: 1 }, 'user').invalid[0]?.reason).toContain('lista');
  });

  it('rejects duplicated ids in the same file', () => {
    expect(reasons([shell(), shell()])).toEqual(['id repetido no arquivo']);
  });
});
