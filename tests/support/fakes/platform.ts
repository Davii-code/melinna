import type { OsName, Platform } from '../../../src/core/ports/platform';

export function fakePlatform(os: OsName, pathEnv: string, pathExt: string[] = []): Platform {
  return { os, pathEnv, pathExt: os === 'win32' ? pathExt.map((e) => e.toLowerCase()) : [] };
}
