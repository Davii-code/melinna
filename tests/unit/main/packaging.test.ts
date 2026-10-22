import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const builder = readFileSync(join(__dirname, '..', '..', '..', 'electron-builder.yml'), 'utf8');

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
});
