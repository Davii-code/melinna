import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const builder = readFileSync(join(root, 'electron-builder.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};
const linux = (file: string) => readFileSync(join(root, 'scripts', 'linux', file), 'utf8');

/** Itens da lista `asarUnpack` do electron-builder.yml (lista YAML simples, um por linha). */
function asarUnpack(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === 'asarUnpack:');
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = /^\s+-\s+(\S+)/.exec(line);
    if (!m) break;
    out.push(m[1] as string);
  }
  return out;
}

describe('empacotamento', () => {
  it('unpacks the host together with the chunks it shares with the main process', () => {
    expect(asarUnpack(builder)).toEqual(
      expect.arrayContaining(['out/host/**', 'out/chunks/**', 'node_modules/node-pty/**']),
    );
  });

  it('names the Windows installer and the Linux AppImage without the version', () => {
    const names = builder.match(/artifactName: melinna\.\$\{ext\}/g) ?? [];
    expect(names).toHaveLength(2);
  });

  it('builds the Linux package from the unpacked app, with the installer scripts', () => {
    expect(pkg.scripts['dist:linux']).toContain('electron-builder --linux');
    expect(pkg.scripts['dist:linux']).toContain('scripts/linux/package.sh');
    const executable = /executableName: (\S+)/.exec(builder)?.[1];
    expect(executable).toBe('melinna-desk');
    for (const file of ['install.sh', 'uninstall.sh', 'package.sh']) {
      expect(linux(file).startsWith('#!/usr/bin/env bash')).toBe(true);
    }
    expect(linux('install.sh')).toContain(`EXECUTABLE="${executable}"`);
    expect(linux('package.sh')).toContain(`linux-unpacked/${executable}`);
  });
});
