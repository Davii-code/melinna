import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeClock } from '../../../src/adapters/node-clock';
import { NodeFileSystem } from '../../../src/adapters/node-fs';
import { nodePlatform } from '../../../src/adapters/node-platform';
import { NodeProcessRunner } from '../../../src/adapters/node-process-runner';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'melinna-adapters-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('NodeFileSystem', () => {
  it('implements the port with error codes preserved', async () => {
    const fs = new NodeFileSystem();
    const f = join(dir, 'a', 'b.txt');
    await fs.mkdir(join(dir, 'a'), { recursive: true });
    await fs.writeFile(f, 'x', { flag: 'wx' });
    await expect(fs.writeFile(f, 'y', { flag: 'wx' })).rejects.toMatchObject({ code: 'EEXIST' });
    await fs.appendFile(f, new Uint8Array([0x79]));
    await fs.fsyncFile(f);
    expect(new TextDecoder().decode(await fs.readFile(f))).toBe('xy');
    expect(await fs.stat(f)).toEqual({ size: 2, isFile: true, isDirectory: false });
    expect(await fs.readdir(join(dir, 'a'))).toEqual(['b.txt']);
    await fs.rename(f, join(dir, 'c.txt'));
    expect(await fs.exists(f)).toBe(false);
    await expect(fs.readFile(f)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.rm(join(dir, 'a'), { recursive: true });
    expect(await fs.exists(join(dir, 'a'))).toBe(false);
  });
});

describe('NodeProcessRunner', () => {
  const runner = new NodeProcessRunner();
  const node = process.execPath;

  it('runs without a shell and returns binary output and exit codes', async () => {
    const r = await runner.run(
      node,
      ['-e', 'process.stdout.write(Buffer.from([0,1,2])); process.stderr.write("e"); process.exit(3)'],
      {},
    );
    expect(r.exitCode).toBe(3);
    expect(Array.from(r.stdout)).toEqual([0, 1, 2]);
    expect(new TextDecoder().decode(r.stderr)).toBe('e');
  });

  it('passes shell metacharacters literally', async () => {
    const arg = 'a & b | c ; $(echo x) `y` "q"';
    const r = await runner.run(node, ['-e', 'process.stdout.write(process.argv[1])', arg], { cwd: dir });
    expect(new TextDecoder().decode(r.stdout)).toBe(arg);
  });

  it('rejects when the program does not exist or times out', async () => {
    await expect(runner.run(join(dir, 'nope'), [], {})).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      runner.run(node, ['-e', 'setTimeout(()=>{}, 5000)'], { timeoutMs: 200 }),
    ).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    });
  });

  it('merges env over the current environment', async () => {
    const r = await runner.run(
      node,
      ['-e', 'process.stdout.write(process.env.MELINNA_T + ":" + Boolean(process.env.PATH))'],
      {
        env: { MELINNA_T: 'ok' },
      },
    );
    expect(new TextDecoder().decode(r.stdout)).toBe('ok:true');
  });
});

describe('nodePlatform and NodeClock', () => {
  it('reads PATH and PATHEXT', () => {
    expect(nodePlatform({ PATH: '/bin' }, 'linux')).toEqual({ os: 'linux', pathEnv: '/bin', pathExt: [] });
    expect(nodePlatform({ Path: 'C:\\x', PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual({
      os: 'win32',
      pathEnv: 'C:\\x',
      pathExt: ['.exe', '.cmd'],
    });
  });

  it('schedules and cancels', async () => {
    const clock = new NodeClock();
    let fired = 0;
    clock.setTimeout(() => fired++, 5);
    clock.setTimeout(() => fired++, 5)();
    await new Promise((r) => setTimeout(r, 30));
    expect(fired).toBe(1);
    expect(clock.now()).toBeInstanceOf(Date);
  });
});
