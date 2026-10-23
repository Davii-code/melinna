import { describe, expect, it } from 'vitest';
import { MelinnaError } from '../../../../src/core/errors';
import {
  BATCH_PROGRAM_MESSAGE,
  checkProgram,
  resolveProgram,
} from '../../../../src/core/run/resolve-program';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { fakePlatform } from '../../../support/fakes/platform';

const win = fakePlatform('win32', 'C:\\tools;C:\\nodejs', ['.COM', '.EXE', '.BAT', '.CMD']);
const linux = fakePlatform('linux', '/usr/local/bin:/usr/bin');

async function failure(p: Promise<unknown>): Promise<MelinnaError> {
  try {
    await p;
  } catch (err) {
    return err as MelinnaError;
  }
  throw new Error('esperava falha');
}

function seedNpm(fs: MemoryFileSystem, name: string, bin: string): void {
  fs.seed(`C:\\nodejs\\${name}.cmd`, 'shim');
  fs.seed(`C:\\nodejs\\node_modules\\${name}\\package.json`, JSON.stringify({ bin: { [name]: bin } }));
  fs.seed(`C:\\nodejs\\node_modules\\${name}\\${bin.replace(/\//g, '\\')}`, 'js');
}

describe('resolveProgram', () => {
  it('finds an executable on PATH', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/usr/bin/git', 'bin');
    const r = await resolveProgram('git', linux, fs);
    expect(r).toEqual({ file: '/usr/bin/git', prefixArgs: [], executable: true });
  });

  it('fails with PROGRAM_NOT_FOUND naming the program', async () => {
    const err = await failure(resolveProgram('mvn', linux, new MemoryFileSystem()));
    expect(err.code).toBe('PROGRAM_NOT_FOUND');
    expect(err.userMessage).toBe('Programa não encontrado: mvn.');
  });

  it.each(['npm', 'pnpm', 'yarn'])('resolves the %s .cmd shim to node plus the script', async (name) => {
    const fs = new MemoryFileSystem();
    seedNpm(fs, name, 'bin/cli.js');
    fs.seed('C:\\nodejs\\node.exe', 'node');
    const r = await resolveProgram(name, win, fs);
    expect(r.file).toBe('C:\\nodejs\\node.exe');
    expect(r.prefixArgs).toEqual([`C:\\nodejs\\node_modules\\${name}\\bin\\cli.js`]);
    expect(r.executable).toBe(true);
  });

  it('refuses any other .cmd or .bat with the contract message', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\tools\\mvn.cmd', 'batch');
    fs.seed('C:\\tools\\setup.bat', 'batch');
    for (const name of ['mvn', 'setup']) {
      const err = await failure(resolveProgram(name, win, fs));
      expect(err.code).toBe('INPUT_INVALID');
      expect(err.userMessage).toBe(BATCH_PROGRAM_MESSAGE);
    }
    expect(BATCH_PROGRAM_MESSAGE).toBe('Este programa só roda pelo prompt de comando; use o executável.');
  });

  it('refuses a shim whose package cannot be found', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\nodejs\\npm.cmd', 'shim');
    const err = await failure(resolveProgram('npm', win, fs));
    expect(err.code).toBe('INPUT_INVALID');
  });

  it('flags a file without the execute bit on POSIX and accepts one with it', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/work/app/mvnw', '#!/bin/sh');
    fs.setMode('/work/app/mvnw', 0o644);
    expect((await resolveProgram('/work/app/mvnw', linux, fs)).executable).toBe(false);
    fs.setMode('/work/app/mvnw', 0o755);
    expect((await resolveProgram('/work/app/mvnw', linux, fs)).executable).toBe(true);
  });

  it('never flags the execute bit on Windows', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\tools\\git.exe', 'bin');
    fs.setMode('C:\\tools\\git.exe', 0o644);
    expect((await resolveProgram('git', win, fs)).executable).toBe(true);
  });
});

describe('checkProgram', () => {
  it('reports availability and what was searched', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('/usr/bin/git', 'bin');
    expect(await checkProgram('git', linux, fs)).toEqual({ available: true, searched: 'git' });
    expect(await checkProgram('mvn', linux, fs)).toEqual({ available: false, searched: 'mvn' });
  });

  it('treats a refused batch file as unavailable', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\tools\\mvn.cmd', 'batch');
    expect(await checkProgram('mvn', win, fs)).toEqual({ available: false, searched: 'mvn' });
  });
});
