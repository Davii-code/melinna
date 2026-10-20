import { describe, expect, it } from 'vitest';
import {
  builtinCatalogPath,
  hostScriptPath,
  preloadPath,
  rendererRoot,
  userDataOverride,
} from '../../../src/main/app-paths';

describe('app paths', () => {
  it('finds the builtin catalog packaged and in development', () => {
    expect(
      builtinCatalogPath({ isPackaged: true, resourcesPath: '/opt/Melinna/resources', mainDir: '/x' }),
    ).toBe('/opt/Melinna/resources/catalog/agents.json');
    expect(builtinCatalogPath({ isPackaged: false, resourcesPath: '/r', mainDir: '/proj/out/main' })).toBe(
      '/proj/catalog/agents.json',
    );
  });

  it('runs the host from outside the asar archive', () => {
    expect(hostScriptPath('/opt/Melinna/resources/app.asar/out/main')).toBe(
      '/opt/Melinna/resources/app.asar.unpacked/out/host/main.js',
    );
    expect(hostScriptPath('/proj/out/main')).toBe('/proj/out/host/main.js');
    expect(preloadPath('/proj/out/main')).toBe('/proj/out/preload/preload.js');
    expect(rendererRoot('/proj/out/main')).toBe('/proj/out/renderer');
  });

  it('reads the MELINNA_USER_DATA override', () => {
    expect(userDataOverride({ MELINNA_USER_DATA: '/tmp/u' })).toBe('/tmp/u');
    expect(userDataOverride({})).toBeNull();
  });
});
