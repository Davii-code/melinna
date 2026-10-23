import { describe, expect, it } from 'vitest';
import { detectFolder, detectFolders } from '../../../../src/core/run/detect';
import type { RunCommand } from '../../../../src/core/run/types';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { fakePlatform } from '../../../support/fakes/platform';

const linux = fakePlatform('linux', '/usr/bin');
const win = fakePlatform('win32', 'C:\\tools;C:\\nodejs', ['.COM', '.EXE', '.BAT', '.CMD']);

const APP = '/work/app';

function pkg(scripts: Record<string, string> | undefined): string {
  return JSON.stringify(scripts ? { name: 'x', scripts } : { name: 'x' });
}

function seedTools(fs: MemoryFileSystem, ...names: string[]): void {
  for (const n of names) fs.seed(`/usr/bin/${n}`, 'bin');
}

function find(commands: RunCommand[], label: string): RunCommand {
  const c = commands.find((x) => x.label === label);
  if (!c) throw new Error(`sem configuração "${label}": ${commands.map((x) => x.label).join(', ')}`);
  return c;
}

async function detect(fs: MemoryFileSystem, platform = linux, folder = APP, groupId = 'g1') {
  return detectFolder({ fs, platform }, groupId, folder);
}

describe('detectFolder — package.json', () => {
  it('creates one npm configuration per script', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm');
    fs.seed(`${APP}/package.json`, pkg({ dev: 'vite', test: 'vitest' }));
    const { commands, warnings } = await detect(fs);
    expect(warnings).toEqual([]);
    expect(commands.map((c) => c.label)).toEqual(['dev', 'test']);
    expect(commands[0]).toMatchObject({
      groupId: 'g1',
      source: 'npm',
      tool: 'npm',
      program: 'npm',
      args: ['run', 'dev'],
      folder: APP,
      available: true,
      unavailableReason: null,
    });
  });

  it('picks pnpm and yarn from the lock file', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm', 'pnpm', 'yarn');
    fs.seed('/work/p/package.json', pkg({ build: 'x' }));
    fs.seed('/work/p/pnpm-lock.yaml', '');
    fs.seed('/work/y/package.json', pkg({ build: 'x' }));
    fs.seed('/work/y/yarn.lock', '');
    const p = (await detect(fs, linux, '/work/p')).commands[0];
    const y = (await detect(fs, linux, '/work/y')).commands[0];
    expect(p).toMatchObject({ tool: 'pnpm', program: 'pnpm', args: ['run', 'build'], source: 'npm' });
    expect(y).toMatchObject({ tool: 'yarn', program: 'yarn', args: ['run', 'build'], source: 'npm' });
  });

  it('keeps a script name with shell characters as one argument', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm');
    fs.seed(`${APP}/package.json`, pkg({ 'a; rm -rf $(x)': 'echo' }));
    const [c] = (await detect(fs)).commands;
    expect(c?.args).toEqual(['run', 'a; rm -rf $(x)']);
  });

  it('ignores non-string scripts', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm');
    fs.seed(`${APP}/package.json`, JSON.stringify({ scripts: { ok: 'x', bad: 3 } }));
    expect((await detect(fs)).commands.map((c) => c.label)).toEqual(['ok']);
  });

  it('gives nothing, and no warning, when there are no scripts', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/package.json`, pkg(undefined));
    expect(await detect(fs)).toEqual({ commands: [], warnings: [] });
    fs.seed(`${APP}/package.json`, pkg({}));
    expect(await detect(fs)).toEqual({ commands: [], warnings: [] });
  });

  it('turns an invalid package.json into a warning', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/package.json`, '{ "scripts":');
    const r = await detect(fs);
    expect(r.commands).toEqual([]);
    expect(r.warnings).toEqual([{ groupId: 'g1', folder: APP, message: 'package.json inválido; ignorado.' }]);
  });

  it('ignores a file over 1 MB with a warning', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/package.json`, 'x'.repeat(1024 * 1024 + 1));
    const r = await detect(fs);
    expect(r.commands).toEqual([]);
    expect(r.warnings[0]?.message).toBe('package.json maior que 1 MB; ignorado.');
  });

  it('marks the configuration unavailable when the tool is missing', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/package.json`, pkg({ dev: 'x' }));
    const [c] = (await detect(fs)).commands;
    expect(c).toMatchObject({
      available: false,
      unavailableReason: 'not-found',
      searched: 'npm',
    });
  });
});

describe('detectFolder — Maven', () => {
  it('creates compile, test and package with the system mvn when there is no wrapper', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'mvn');
    fs.seed(`${APP}/pom.xml`, '<project/>');
    const { commands } = await detect(fs);
    expect(commands.map((c) => c.label)).toEqual(['Maven: compile', 'Maven: test', 'Maven: package']);
    expect(commands[0]).toMatchObject({
      source: 'maven',
      tool: 'maven',
      program: 'mvn',
      args: ['compile'],
      available: true,
    });
  });

  it('uses the project wrapper on POSIX', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/pom.xml`, '<project/>');
    fs.seed(`${APP}/mvnw`, '#!/bin/sh');
    fs.setMode(`${APP}/mvnw`, 0o755);
    const { commands, warnings } = await detect(fs);
    expect(warnings).toEqual([]);
    expect(commands[0]).toMatchObject({ program: `${APP}/mvnw`, args: ['compile'], available: true });
  });

  it('keeps a wrapper without the execute bit available (the start asks what to do)', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/pom.xml`, '<project/>');
    fs.seed(`${APP}/mvnw`, '#!/bin/sh');
    fs.setMode(`${APP}/mvnw`, 0o644);
    expect((await detect(fs)).commands[0]).toMatchObject({ program: `${APP}/mvnw`, available: true });
  });

  it('ignores mvnw.cmd on Windows with a warning and falls back to mvn', async () => {
    const fs = new MemoryFileSystem();
    fs.seed('C:\\tools\\mvn.exe', 'bin');
    fs.seed('C:\\work\\m\\pom.xml', '<project/>');
    fs.seed('C:\\work\\m\\mvnw.cmd', '@echo off');
    const r = await detect(fs, win, 'C:\\work\\m');
    expect(r.commands[0]).toMatchObject({ program: 'mvn', available: true });
    expect(r.warnings).toEqual([
      {
        groupId: 'g1',
        folder: 'C:\\work\\m',
        message: 'Wrapper do projeto (mvnw.cmd) ignorado no Windows; usando mvn do sistema.',
      },
    ]);
  });

  it('reports the missing tool', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/pom.xml`, '<project/>');
    expect((await detect(fs)).commands[0]).toMatchObject({
      available: false,
      unavailableReason: 'not-found',
      searched: 'mvn',
    });
  });
});

describe('detectFolder — Gradle', () => {
  it('creates build and test for any Gradle project', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'gradle');
    fs.seed(`${APP}/build.gradle`, "plugins { id 'java' }");
    const { commands } = await detect(fs);
    expect(commands.map((c) => c.label)).toEqual(['Gradle: build', 'Gradle: test']);
    expect(commands[0]).toMatchObject({
      source: 'gradle',
      tool: 'gradle',
      program: 'gradle',
      args: ['build'],
    });
  });

  it('adds run for the application plugin (Kotlin DSL, Groovy id and apply plugin)', async () => {
    for (const body of [
      'plugins {\n    application\n}',
      "plugins { id 'application' }",
      "apply plugin: 'application'",
    ]) {
      const fs = new MemoryFileSystem();
      seedTools(fs, 'gradle');
      fs.seed(`${APP}/build.gradle.kts`, body);
      const labels = (await detect(fs)).commands.map((c) => c.label);
      expect(labels).toEqual(['Gradle: build', 'Gradle: test', 'Gradle: run']);
    }
  });

  it('adds bootRun for Spring Boot', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'gradle');
    fs.seed(`${APP}/build.gradle.kts`, 'plugins {\n    id("org.springframework.boot") version "3.3.0"\n}');
    const { commands } = await detect(fs);
    expect(commands.map((c) => c.label)).toEqual(['Gradle: build', 'Gradle: test', 'Gradle: bootRun']);
    expect(find(commands, 'Gradle: bootRun').args).toEqual(['bootRun']);
  });

  it('uses the project wrapper on POSIX and ignores gradlew.bat on Windows with a warning', async () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${APP}/build.gradle`, '');
    fs.seed(`${APP}/gradlew`, '#!/bin/sh');
    fs.setMode(`${APP}/gradlew`, 0o755);
    expect((await detect(fs)).commands[0]?.program).toBe(`${APP}/gradlew`);

    const w = new MemoryFileSystem();
    w.seed('C:\\tools\\gradle.exe', 'bin');
    w.seed('C:\\work\\g\\build.gradle', '');
    w.seed('C:\\work\\g\\gradlew.bat', '@echo off');
    const r = await detect(w, win, 'C:\\work\\g');
    expect(r.commands[0]).toMatchObject({ program: 'gradle', available: true });
    expect(r.warnings[0]?.message).toBe(
      'Wrapper do projeto (gradlew.bat) ignorado no Windows; usando gradle do sistema.',
    );
  });
});

describe('detectFolder — Compose', () => {
  it.each(['docker-compose.yml', 'compose.yaml', 'compose.yml', 'docker-compose.yaml'])(
    'creates up and down for %s with docker compose',
    async (file) => {
      const fs = new MemoryFileSystem();
      seedTools(fs, 'docker');
      fs.seed(`${APP}/${file}`, 'services: {}');
      const { commands } = await detect(fs);
      expect(commands.map((c) => c.label)).toEqual(['Compose: subir', 'Compose: derrubar']);
      expect(commands[0]).toMatchObject({
        source: 'compose',
        tool: 'compose',
        program: 'docker',
        args: ['compose', 'up'],
      });
      expect(commands[1]?.args).toEqual(['compose', 'down']);
    },
  );

  it('falls back to the legacy docker-compose only when docker is missing', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'docker-compose');
    fs.seed(`${APP}/compose.yaml`, 'services: {}');
    const { commands } = await detect(fs);
    expect(commands[0]).toMatchObject({ program: 'docker-compose', args: ['up'], available: true });
    expect(commands[1]).toMatchObject({ program: 'docker-compose', args: ['down'] });
  });

  it('prefers docker compose when both exist', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'docker', 'docker-compose');
    fs.seed(`${APP}/compose.yaml`, 'services: {}');
    expect((await detect(fs)).commands[0]?.program).toBe('docker');
  });

  it('creates one pair when several compose files exist', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'docker');
    fs.seed(`${APP}/compose.yaml`, 'services: {}');
    fs.seed(`${APP}/docker-compose.yml`, 'services: {}');
    expect((await detect(fs)).commands).toHaveLength(2);
  });
});

describe('detectFolder — ids and folders', () => {
  it('has stable ids across calls and different ids across workspaces and folders', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm');
    fs.seed(`${APP}/package.json`, pkg({ dev: 'x' }));
    fs.seed('/work/other/package.json', pkg({ dev: 'x' }));
    const a = (await detect(fs)).commands[0]?.id;
    const again = (await detect(fs)).commands[0]?.id;
    const otherGroup = (await detect(fs, linux, APP, 'g2')).commands[0]?.id;
    const otherFolder = (await detect(fs, linux, '/work/other')).commands[0]?.id;
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(again).toBe(a);
    expect(otherGroup).not.toBe(a);
    expect(otherFolder).not.toBe(a);
  });

  it('keeps ids unique inside one folder with several tools', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm', 'mvn', 'gradle', 'docker');
    fs.seed(`${APP}/package.json`, pkg({ build: 'x' }));
    fs.seed(`${APP}/pom.xml`, '<project/>');
    fs.seed(`${APP}/build.gradle`, '');
    fs.seed(`${APP}/compose.yaml`, '');
    const { commands } = await detect(fs);
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length);
    expect(commands.map((c) => c.source)).toEqual([
      'npm',
      'maven',
      'maven',
      'maven',
      'gradle',
      'gradle',
      'compose',
      'compose',
    ]);
  });

  it('detects several folders and one that has nothing is simply empty', async () => {
    const fs = new MemoryFileSystem();
    seedTools(fs, 'npm');
    fs.seed('/work/a/package.json', pkg({ dev: 'x' }));
    fs.seed('/work/b/package.json', pkg({ test: 'x' }));
    fs.seed('/work/empty/readme.md', '');
    const r = await detectFolders({ fs, platform: linux }, [
      { groupId: 'g1', folder: '/work/a' },
      { groupId: 'g1', folder: '/work/empty' },
      { groupId: 'g2', folder: '/work/b' },
    ]);
    expect(r.commands.map((c) => [c.groupId, c.folder, c.label])).toEqual([
      ['g1', '/work/a', 'dev'],
      ['g2', '/work/b', 'test'],
    ]);
  });

  it('does not fail when the folder does not exist', async () => {
    expect(await detect(new MemoryFileSystem(), linux, '/work/gone')).toEqual({
      commands: [],
      warnings: [],
    });
  });
});
