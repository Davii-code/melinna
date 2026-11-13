import { describe, expect, it } from 'vitest';
import { CatalogService } from '../../../../src/core/catalog/catalog-service';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';
import { fakePlatform } from '../../../support/fakes/platform';

const linux = fakePlatform('linux', '/usr/bin');
const win = fakePlatform('win32', 'C:\\npm', ['.EXE', '.CMD']);

function agent(id: string, headless?: string[]): Record<string, unknown> {
  return {
    id,
    displayName: id.toUpperCase(),
    kind: 'agent',
    executable: { command: id },
    args: [],
    prompt: { delivery: 'argument', args: ['{prompt}'] },
    ...(headless ? { headless: { args: headless } } : {}),
    detect: { strategy: 'path' },
  };
}

function service(agents: unknown[], installed: string[], platform = linux) {
  const fs = new MemoryFileSystem();
  fs.seed('/app/agents.json', JSON.stringify({ schemaVersion: 1, agents }));
  for (const p of installed) fs.seed(p, 'bin');
  return new CatalogService({
    fs,
    platform,
    log: new MemoryLogger(),
    builtinPath: '/app/agents.json',
    userPath: '/data/catalog.json',
  });
}

describe('CatalogService.headlessLaunch', () => {
  it('picks the first installed agent that declares headless, in catalog order', async () => {
    const catalog = service(
      [agent('gemini'), agent('claude', ['-p']), agent('codex', ['exec', '-'])],
      ['/usr/bin/gemini', '/usr/bin/claude', '/usr/bin/codex'],
    );
    const launch = await catalog.headlessLaunch();
    expect(launch).toMatchObject({ file: '/usr/bin/claude', args: ['-p'] });
    expect(launch?.agent.id).toBe('claude');
  });

  it('skips agents that are not installed', async () => {
    const catalog = service([agent('claude', ['-p']), agent('codex', ['exec', '-'])], ['/usr/bin/codex']);
    expect(await catalog.headlessLaunch()).toMatchObject({ file: '/usr/bin/codex', args: ['exec', '-'] });
  });

  it('returns null when no headless agent is installed', async () => {
    expect(await service([agent('claude', ['-p'])], []).headlessLaunch()).toBeNull();
    expect(await service([agent('gemini')], ['/usr/bin/gemini']).headlessLaunch()).toBeNull();
  });

  it('treats a batch launcher without a safe npm shim as not installed', async () => {
    const catalog = service([agent('claude', ['-p'])], ['C:\\npm\\claude.cmd'], win);
    expect(await catalog.headlessLaunch()).toBeNull();
  });
});

describe('CatalogService.chatLaunch', () => {
  const chat = { format: 'claude-stream-json', args: ['-p', '--verbose'], resumeArgs: ['--resume'] };
  const permission = {
    options: [
      { id: 'manual', label: 'Perguntar', args: ['--permission-mode', 'manual'] },
      { id: 'plan', label: 'Planejar', args: ['--permission-mode', 'plan'] },
      { id: 'bypass', label: 'Sem confirmações', args: ['--yolo'], dangerous: true },
    ],
    default: 'manual',
    switch: { strategy: 'unsupported' },
  };
  const chatAgent = { ...agent('claude'), chat, permission };

  it('uses the default permission mode of the agent when none is asked', async () => {
    const launch = await service([agent('codex', ['exec']), chatAgent], ['/usr/bin/claude']).chatLaunch();
    expect(launch).toMatchObject({
      file: '/usr/bin/claude',
      args: ['-p', '--verbose', '--permission-mode', 'manual'],
      resumeArgs: ['--resume'],
    });
  });

  it('applies the chosen permission mode', async () => {
    const launch = await service([chatAgent], ['/usr/bin/claude']).chatLaunch('plan');
    expect(launch?.args).toEqual(['-p', '--verbose', '--permission-mode', 'plan']);
  });

  it('refuses unknown modes and modes that turn confirmations off', async () => {
    const catalog = service([chatAgent], ['/usr/bin/claude']);
    await expect(catalog.chatLaunch('nao-existe')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(catalog.chatLaunch('bypass')).rejects.toMatchObject({
      userMessage: 'O chat não aceita modos que desligam as confirmações do agente.',
    });
  });

  it('returns null when no chat agent is installed', async () => {
    expect(await service([chatAgent], []).chatLaunch()).toBeNull();
    expect(await service([agent('codex', ['exec'])], ['/usr/bin/codex']).chatLaunch()).toBeNull();
  });
});
