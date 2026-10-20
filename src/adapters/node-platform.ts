import type { OsName, Platform } from '../core/ports/platform';

export function nodePlatform(
  env: NodeJS.ProcessEnv = process.env,
  os: NodeJS.Platform = process.platform,
): Platform {
  const name: OsName = os === 'win32' ? 'win32' : os === 'darwin' ? 'darwin' : 'linux';
  const pathEnv = env.PATH ?? env.Path ?? env.path ?? '';
  const pathExt =
    name === 'win32'
      ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter((e) => e.length > 0)
          .map((e) => e.toLowerCase())
      : [];
  return { os: name, pathEnv, pathExt };
}
