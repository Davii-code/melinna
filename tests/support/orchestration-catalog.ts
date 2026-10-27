import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemNode } from './fake-catalog';

/** Separate fake CLI binaries; the production resolver still follows its real npm-shim path. */
export function orchestrationCatalog(directory: string): string {
  const bin = join(directory, 'orchestration-bin');
  const pkg = join(bin, 'node_modules', '@melinna', 'fake-orchestration');
  mkdirSync(pkg, { recursive: true });
  const fixture = join(__dirname, '../fixtures/fake-orchestration-agent.mjs');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ bin: { agent: 'agent.cjs' } }));
  writeFileSync(
    join(pkg, 'agent.cjs'),
    'import(' + JSON.stringify(fixture.replaceAll('\\', '/').replace(/^([A-Za-z]):/, 'file:///$1:')) + ');',
  );
  const command = join(bin, process.platform === 'win32' ? 'fake.cmd' : 'fake');
  if (process.platform === 'win32') writeFileSync(command, '@echo off\r\n');
  else {
    writeFileSync(command, '#!' + systemNode() + '\nimport(' + JSON.stringify(fixture) + ');\n');
    chmodSync(command, 0o755);
  }
  return JSON.stringify({
    schemaVersion: 1,
    agents: ['claude', 'codex'].map((id) => ({
      id,
      displayName: 'Fake ' + id,
      kind: 'agent',
      executable: { command, windows: { npmShim: { package: '@melinna/fake-orchestration', bin: 'agent' } } },
      args: [],
      prompt: { delivery: 'argument', args: ['{prompt}'] },
      detect: { strategy: 'path' },
    })),
  });
}
