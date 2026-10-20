import { describe, expect, it } from 'vitest';
import { loadCatalog } from '../../../../src/core/catalog/load';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const shell = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: id,
  kind: 'shell',
  executable: { command: id },
  args: [],
  prompt: { delivery: 'none' },
  detect: { strategy: 'path' },
  ...extra,
});

function setup(builtin: unknown, user?: string) {
  const fs = new MemoryFileSystem();
  fs.seed('/app/catalog/agents.json', JSON.stringify(builtin));
  fs.seed('/data/.keep', '');
  if (user !== undefined) fs.seed('/data/catalog.json', user);
  const log = new MemoryLogger();
  return {
    log,
    load: () =>
      loadCatalog({
        fs,
        builtinPath: '/app/catalog/agents.json',
        userPath: '/data/catalog.json',
        os: 'linux',
        log,
      }),
  };
}

describe('loadCatalog', () => {
  it('uses only the builtin catalog when the user has none', async () => {
    const { load } = setup({ schemaVersion: 1, agents: [shell('bash'), shell('zsh')] });
    const r = await load();
    expect(r.agents.map((a) => a.id)).toEqual(['bash', 'zsh']);
    expect(r.invalid).toEqual([]);
  });

  it('replaces builtin entries by id and adds new ones from the user file', async () => {
    const { load } = setup(
      { schemaVersion: 1, agents: [shell('bash'), shell('zsh')] },
      JSON.stringify({
        schemaVersion: 1,
        agents: [shell('bash', { displayName: 'Meu bash', args: ['-l'] }), shell('fish')],
      }),
    );
    const r = await load();
    expect(r.agents.map((a) => [a.id, a.displayName])).toEqual([
      ['bash', 'Meu bash'],
      ['zsh', 'zsh'],
      ['fish', 'fish'],
    ]);
    expect(r.agents[0]?.args).toEqual(['-l']);
  });

  it('turns an invalid user JSON into an issue without dropping builtin agents', async () => {
    const { load, log } = setup({ schemaVersion: 1, agents: [shell('bash')] }, '{ quebrado');
    const r = await load();
    expect(r.agents.map((a) => a.id)).toEqual(['bash']);
    expect(r.invalid).toEqual([{ source: 'user', reason: 'JSON inválido' }]);
    expect(log.events()).toContain('catalog.invalid_entry');
  });

  it('keeps the builtin entry when the user override is invalid', async () => {
    const { load } = setup(
      { schemaVersion: 1, agents: [shell('bash')] },
      JSON.stringify({ schemaVersion: 1, agents: [{ ...shell('bash'), kind: 'x' }] }),
    );
    const r = await load();
    expect(r.agents[0]?.displayName).toBe('bash');
    expect(r.invalid[0]).toMatchObject({ source: 'user', id: 'bash' });
  });

  it('filters entries by platform', async () => {
    const { load } = setup({
      schemaVersion: 1,
      agents: [shell('cmd', { platforms: ['win32'] }), shell('bash', { platforms: ['linux'] })],
    });
    expect((await load()).agents.map((a) => a.id)).toEqual(['bash']);
  });
});
