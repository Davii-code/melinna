import { createHash } from 'node:crypto';
import type { AppPaths } from '../paths';
import type { OsName } from '../ports/platform';

/** Endereço local do hospedeiro: pipe nomeado no Windows, socket Unix em `<userData>/host/sock` no POSIX. */
export function hostEndpointPath(paths: AppPaths, os: OsName, username: string): string {
  if (os !== 'win32') return paths.hostSocket;
  const hash = createHash('sha256')
    .update(`${username}\0${paths.userData.toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `\\\\.\\pipe\\melinna-desk-${hash}`;
}

export interface EndpointFile {
  path: string;
  pid: number;
  protocolVersion: number;
}

export function parseEndpointFile(text: string): EndpointFile | null {
  try {
    const raw = JSON.parse(text) as Partial<EndpointFile>;
    if (
      typeof raw.path === 'string' &&
      typeof raw.pid === 'number' &&
      typeof raw.protocolVersion === 'number'
    ) {
      return { path: raw.path, pid: raw.pid, protocolVersion: raw.protocolVersion };
    }
  } catch {
    return null;
  }
  return null;
}
