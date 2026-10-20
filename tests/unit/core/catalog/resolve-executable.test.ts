import { describe, expect, it } from 'vitest';
import { detect, resolveLauncher } from '../../../../src/core/catalog/detect';
import { resolveExecutable } from '../../../../src/core/catalog/resolve-executable';
import type { AgentDefinition } from '../../../../src/core/catalog/schema';
import { MelinnaError } from '../../../../src/core/errors';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { fakePlatform } from '../../../support/fakes/platform';

const win = fakePlatform('win32', 'C:\\tools;C:\\npm', ['.COM', '.EXE', '.BAT', '.CMD']);
const linux = fakePlatform('linux', '/usr/local/bin:/usr/bin');

function agent(windows?: AgentDefinition['executable']['windows']): AgentDefinition {
  const executable: AgentDefinition['executable'] = { command: 'claude' };
  if (windows) executable.windows = windows;
  return {
    id: 'claude',
    displayName: 'Claude',
    kind: 'agent',
    executable,
    args: [],
    prompt: { delivery: 'argument', args: ['{prompt}'] },
    detect: { strategy: 'path' },
  };
}

async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as MelinnaError).code;
  }
  return 'none';
}

describe('resolveExecutable', () => {
  it('searches PATH in order on POSIX', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/usr/bin/git', 'bin');
    fs.seed('/usr/local/bin/git', 'bin');
    expect(await resolveExecutable('git', linux, fs)).toBe('/usr/local/bin/git');
    expect(await resolveExecutable('nope', linux, fs)).toBeNull();
  });

  it('applies PATHEXT on Windows and keeps explicit extensions', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\npm\\claude.cmd', 'shim');
    fs.seed('C:\\tools\\git.exe', 'bin');
    expect(await resolveExecutable('git', win, fs)).toBe('C:\\tools\\git.exe');
    expect(await resolveExecutable('claude', win, fs)).toBe('C:\\npm\\claude.cmd');
    expect(await resolveExecutable('git.exe', win, fs)).toBe('C:\\tools\\git.exe');
  });

  it('accepts absolute paths only when they exist and rejects relative paths with separators', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/opt/agent/run', 'x');
    expect(await resolveExecutable('/opt/agent/run', linux, fs)).toBe('/opt/agent/run');
    expect(await resolveExecutable('/opt/agent/missing', linux, fs)).toBeNull();
    expect(await resolveExecutable('./run', linux, fs)).toBeNull();
  });
});

describe('resolveLauncher and detect', () => {
  it('reports not installed with the searched name', async () => {
    const r = await detect(agent(), linux, new MemoryFileSystem());
    expect(r).toEqual({ installed: false, searched: 'claude', reason: 'Executável claude não encontrado.' });
    expect(await errCode(resolveLauncher(agent(), linux, new MemoryFileSystem()))).toBe(
      'EXECUTABLE_NOT_FOUND',
    );
  });

  it('resolves a .cmd npm shim to node + script', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\npm\\claude.cmd', 'shim');
    fs.seed(
      'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\package.json',
      JSON.stringify({ bin: { claude: 'cli.js' } }),
    );
    fs.seed('C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js', '');
    fs.seed('C:\\tools\\node.exe', '');
    const def = agent({ npmShim: { package: '@anthropic-ai/claude-code', bin: 'claude' } });
    const l = await resolveLauncher(def, win, fs);
    expect(l.file).toBe('C:\\tools\\node.exe');
    expect(l.prefixArgs).toEqual(['C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js']);
    expect((await detect(def, win, fs)).installed).toBe(true);
  });

  it('prefers a native .exe target and a node.exe beside the shim', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\npm\\claude.cmd', 'shim');
    fs.seed('C:\\npm\\node_modules\\pkg\\package.json', JSON.stringify({ bin: 'bin/claude.exe' }));
    fs.seed('C:\\npm\\node_modules\\pkg\\bin\\claude.exe', '');
    const l = await resolveLauncher(agent({ npmShim: { package: 'pkg', bin: 'claude' } }), win, fs);
    expect(l).toEqual({ file: 'C:\\npm\\node_modules\\pkg\\bin\\claude.exe', prefixArgs: [] });

    const fs2 = new MemoryFileSystem();
    fs2.seed('C:\\npm\\claude.cmd', 'shim');
    fs2.seed('C:\\npm\\node.exe', '');
    fs2.seed('C:\\npm\\node_modules\\pkg\\package.json', JSON.stringify({ bin: { claude: 'cli.js' } }));
    fs2.seed('C:\\npm\\node_modules\\pkg\\cli.js', '');
    expect(
      (await resolveLauncher(agent({ npmShim: { package: 'pkg', bin: 'claude' } }), win, fs2)).file,
    ).toBe('C:\\npm\\node.exe');
  });

  it('refuses .cmd without a safe resolution and never returns .cmd/.bat as file', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\npm\\claude.cmd', 'shim');
    expect(await errCode(resolveLauncher(agent(), win, fs))).toBe('UNSAFE_LAUNCHER');
    expect(
      await errCode(resolveLauncher(agent({ npmShim: { package: 'missing', bin: 'claude' } }), win, fs)),
    ).toBe('UNSAFE_LAUNCHER');
    fs.seed('C:\\npm\\node_modules\\pkg\\package.json', JSON.stringify({ bin: { claude: '../../evil.js' } }));
    expect(
      await errCode(resolveLauncher(agent({ npmShim: { package: 'pkg', bin: 'claude' } }), win, fs)),
    ).toBe('UNSAFE_LAUNCHER');
    const bat = new MemoryFileSystem();
    bat.seed('C:\\tools\\claude.bat', '');
    const r = await detect(agent(), win, bat);
    expect(r.installed).toBe(false);
    expect(r.reason).toContain('com segurança');
  });

  it('uses the Windows command override', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\tools\\pwsh.exe', '');
    const def: AgentDefinition = {
      ...agent(),
      executable: { command: 'pwsh-unix', windows: { command: 'pwsh' } },
    };
    expect((await resolveLauncher(def, win, fs)).file).toBe('C:\\tools\\pwsh.exe');
  });
});
