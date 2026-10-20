import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const FAKE_AGENT_PATH = join(__dirname, '..', 'fixtures', 'fake-agent.mjs');

/** Caminho absoluto de um `node` real (fora do Electron) para rodar o agente falso. */
export function systemNode(): string {
  if (!process.versions.electron) return process.execPath;
  const finder = process.platform === 'win32' ? 'where' : 'which';
  return execFileSync(finder, ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0]!.trim();
}

/** Texto do catálogo falso com os caminhos absolutos desta máquina. */
export function fakeCatalogJson(): string {
  const raw = readFileSync(join(__dirname, '..', 'fixtures', 'catalog.fake.json'), 'utf8');
  return raw
    .replaceAll('"__NODE__"', JSON.stringify(systemNode()))
    .replaceAll('"__FAKE_AGENT__"', JSON.stringify(FAKE_AGENT_PATH));
}
