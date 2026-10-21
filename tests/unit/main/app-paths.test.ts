import { describe, expect, it } from 'vitest';
import {
  builtinCatalogPath,
  hostScriptPath,
  preloadPath,
  rendererRoot,
  userDataOverride,
} from '../../../src/main/app-paths';

describe('app paths', () => {
  // As funções usam `node:path`, portanto devolvem separador nativo; comparar em forma POSIX mantém o
  // teste igual em Windows e POSIX sem perder o que ele verifica (a estrutura dos caminhos).
  const slash = (p: string): string => p.replace(/\\/g, '/');

  it('finds the builtin catalog packaged and in development', () => {
    expect(
      slash(
        builtinCatalogPath({
          isPackaged: true,
          resourcesPath: '/opt/Melinna/resources',
          mainDir: '/x',
        }),
      ),
    ).toBe('/opt/Melinna/resources/catalog/agents.json');
    expect(
      slash(builtinCatalogPath({ isPackaged: false, resourcesPath: '/r', mainDir: '/proj/out/main' })),
    ).toBe('/proj/catalog/agents.json');
  });

  it('runs the host from outside the asar archive', () => {
    expect(slash(hostScriptPath('/opt/Melinna/resources/app.asar/out/main'))).toBe(
      '/opt/Melinna/resources/app.asar.unpacked/out/host/main.js',
    );
    expect(slash(hostScriptPath('/proj/out/main'))).toBe('/proj/out/host/main.js');
    expect(slash(preloadPath('/proj/out/main'))).toBe('/proj/out/preload/preload.js');
    expect(slash(rendererRoot('/proj/out/main'))).toBe('/proj/out/renderer');
  });

  it('reads the MELINNA_USER_DATA override', () => {
    expect(userDataOverride({ MELINNA_USER_DATA: '/tmp/u' })).toBe('/tmp/u');
    expect(userDataOverride({})).toBeNull();
  });
});
