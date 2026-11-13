import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCatalog } from '../../../../src/core/catalog/validate';

const raw: unknown = JSON.parse(readFileSync(join(__dirname, '../../../../catalog/agents.json'), 'utf8'));
const { agents, invalid } = validateCatalog(raw, 'builtin');

describe('builtin catalog', () => {
  it('passes validation entirely', () => {
    expect(invalid).toEqual([]);
    expect(agents.map((a) => a.id)).toEqual([
      'claude',
      'codex',
      'gemini',
      'pwsh',
      'powershell',
      'cmd',
      'git-bash',
      'bash',
      'zsh',
    ]);
  });

  it('records the CLI version each agent was verified with', () => {
    for (const a of agents.filter((x) => x.kind === 'agent'))
      expect(a.verifiedWith).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('declares a safe npm shim for agents installed by npm on Windows', () => {
    for (const a of agents.filter((x) => x.kind === 'agent'))
      expect(a.executable.windows?.npmShim).toBeDefined();
  });

  it('declares platforms on every shell', () => {
    for (const s of agents.filter((x) => x.kind === 'shell')) expect(s.platforms?.length).toBeGreaterThan(0);
  });

  it('marks every mode that turns off confirmations as dangerous', () => {
    const offIds = ['bypassPermissions', 'full-access', 'yolo'];
    for (const a of agents) {
      for (const o of a.permission?.options ?? []) {
        expect(o.dangerous === true, `${a.id}/${o.id}`).toBe(offIds.includes(o.id));
      }
    }
  });

  it('runs headless agents without tools or write access', () => {
    const headless = Object.fromEntries(agents.map((a) => [a.id, a.headless?.args]));
    expect(headless.claude).toEqual([
      '-p',
      '--tools',
      '',
      '--setting-sources',
      'project',
      '--no-session-persistence',
    ]);
    expect(headless.codex?.slice(0, 3)).toEqual(['exec', '--sandbox', 'read-only']);
    expect(headless.codex?.at(-1)).toBe('-');
    expect(Object.entries(headless).filter(([, args]) => args !== undefined).map(([id]) => id)).toEqual([
      'claude',
      'codex',
    ]);
  });

  it('declares chat only for Claude Code, in stream-json', () => {
    expect(agents.filter((a) => a.chat).map((a) => a.id)).toEqual(['claude']);
    expect(agents.find((a) => a.id === 'claude')?.chat).toEqual({
      format: 'claude-stream-json',
      args: ['-p', '--output-format', 'stream-json', '--verbose'],
      resumeArgs: ['--resume'],
    });
  });
});
