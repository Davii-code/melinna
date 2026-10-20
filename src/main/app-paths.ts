import { join } from 'node:path';

/** `MELINNA_USER_DATA` substitui a pasta de dados do app (testes e2e e perfis isolados). */
export function userDataOverride(env: NodeJS.ProcessEnv): string | null {
  const v = env.MELINNA_USER_DATA;
  return v && v.length > 0 ? v : null;
}

/** Empacotado: `resources/catalog`. Em desenvolvimento: `catalog/` na raiz do projeto (dois níveis acima de `out/main`). */
export function builtinCatalogPath(opts: {
  isPackaged: boolean;
  resourcesPath: string;
  mainDir: string;
}): string {
  return opts.isPackaged
    ? join(opts.resourcesPath, 'catalog', 'agents.json')
    : join(opts.mainDir, '..', '..', 'catalog', 'agents.json');
}

/** O hospedeiro roda fora do asar (asarUnpack), com o Node do Electron. */
export function hostScriptPath(mainDir: string): string {
  return join(mainDir, '..', 'host', 'main.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

export function preloadPath(mainDir: string): string {
  return join(mainDir, '..', 'preload', 'preload.js');
}

export function rendererRoot(mainDir: string): string {
  return join(mainDir, '..', 'renderer');
}
