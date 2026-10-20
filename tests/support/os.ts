import type { OsName } from '../../src/core/ports/platform';

export const currentOs: OsName = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';
