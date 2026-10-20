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
});
