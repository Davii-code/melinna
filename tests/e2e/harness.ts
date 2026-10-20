import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { fakeCatalogJson } from '../support/fake-catalog';

const ROOT = join(__dirname, '..', '..');

export interface E2eApp {
  app: ElectronApplication;
  page: Page;
  userData: string;
  close(): Promise<void>;
}

export function makeUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'melinna-e2e-'));
  writeFileSync(join(dir, 'catalog.json'), fakeCatalogJson());
  return dir;
}

export async function launchApp(userData: string): Promise<E2eApp> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const executablePath = require('electron') as unknown as string;
  const args = [join(ROOT, 'out', 'main', 'main.js')];
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    MELINNA_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args, env });
  const page = await app.firstWindow();
  await page.waitForSelector('text=Nova tarefa');
  return {
    app,
    page,
    userData,
    async close() {
      // encerra sem o diálogo de fechamento; o hospedeiro destacado é encerrado em cleanup()
      const closed = new Promise<void>((resolve) => app.once('close', () => resolve()));
      await app
        .evaluate(({ app: electronApp }) => setTimeout(() => electronApp.exit(0), 10))
        .catch(() => undefined);
      await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]);
    },
  };
}

/** Texto gravado no histórico em disco de cada execução (prova que os bytes passaram pelo PTY e pelo hospedeiro). */
export function scrollbackText(userData: string): Record<string, string> {
  const root = join(userData, 'scrollback');
  if (!existsSync(root)) return {};
  const out: Record<string, string> = {};
  for (const execId of readdirSync(root)) {
    const segs = readdirSync(join(root, execId))
      .filter((f) => f.endsWith('.seg'))
      .sort();
    out[execId] = segs.map((s) => readFileSync(join(root, execId, s), 'utf8')).join('');
  }
  return out;
}

export async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs = 15_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('tempo esgotado');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Encerra o hospedeiro destacado deixado pelo app, pelo pid do arquivo endpoint. */
export function killHost(userData: string): void {
  try {
    const { pid } = JSON.parse(readFileSync(join(userData, 'host', 'endpoint'), 'utf8')) as { pid: number };
    process.kill(pid, 'SIGTERM');
  } catch {
    // já encerrado
  }
}

export function cleanup(userData: string): void {
  killHost(userData);
  rmSync(userData, { recursive: true, force: true });
}

export function readState(userData: string): {
  executions: { id: string; agentId: string; status: string; pid: number | null; exitCode: number | null }[];
} {
  return JSON.parse(readFileSync(join(userData, 'state.json'), 'utf8'));
}
