import { describe, it, expect } from 'vitest';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { fakePlatform } from '../../../support/fakes/platform';
import { resolveProgram } from '../../../../src/core/run/resolve-program';
import { deriveProgram, launchPlan } from '../../../../src/core/run/run-configs';
import { detectFolder } from '../../../../src/core/run/detect';
const platform = fakePlatform('win32', 'C:\\jdk\\bin', ['.EXE', '.CMD', '.BAT']);
const folder = 'C:\\work\\app space';
function setup(tool: 'maven' | 'gradle') {
  const fs = new MemoryFileSystem();
  const batch = folder + (tool === 'maven' ? '\\mvnw.cmd' : '\\gradlew.bat');
  const jar =
    folder +
    (tool === 'maven' ? '\\.mvn\\wrapper\\maven-wrapper.jar' : '\\gradle\\wrapper\\gradle-wrapper.jar');
  fs.seed(batch, 'batch');
  fs.seed(jar, 'jar');
  fs.seed('C:\\jdk\\bin\\java.exe', 'java');
  return { fs, platform, batch, jar };
}
describe('Java project wrappers on Windows', () => {
  it.each(['maven', 'gradle'] as const)(
    'launches %s through Java without cmd or global build tool',
    async (tool) => {
      const deps = setup(tool);
      expect(await deriveProgram(tool, folder, deps)).toBe(deps.batch);
      const resolved = await resolveProgram(deps.batch, platform, deps.fs);
      expect(resolved.file).toBe('C:\\jdk\\bin\\java.exe');
      expect(resolved.prefixArgs).toContain(deps.jar);
      expect(resolved.prefixArgs.at(-1)).toBe(
        tool === 'maven'
          ? 'org.apache.maven.wrapper.MavenWrapperMain'
          : 'org.gradle.wrapper.GradleWrapperMain',
      );
      if (tool === 'maven')
        expect(resolved.prefixArgs).toContain('-Dmaven.multiModuleProjectDirectory=' + folder);
    },
  );
  it('reports missing Java rather than silently requiring Maven', async () => {
    const deps = setup('maven');
    await expect(resolveProgram(deps.batch, { ...platform, pathEnv: '' }, deps.fs)).rejects.toMatchObject({
      code: 'PROGRAM_NOT_FOUND',
    });
  });
  it('detects Spring Boot run and keeps arguments separate', async () => {
    const deps = setup('maven');
    deps.fs.seed(
      folder + '\\pom.xml',
      '<project><artifactId>spring-boot-starter-parent</artifactId></project>',
    );
    const catalog = await detectFolder(deps, 'g1', folder);
    const run = catalog.commands.find((c) => c.label === 'Maven: spring-boot:run');
    expect(run).toMatchObject({ program: deps.batch, args: ['spring-boot:run'], available: true });
    const plan = await launchPlan(
      {
        tool: 'maven',
        folder,
        script: 'spring-boot:run',
        args: ['-Dspring-boot.run.profiles=dev'],
      } as Parameters<typeof launchPlan>[0],
      deps,
    );
    expect(plan).toEqual({
      program: deps.batch,
      args: ['spring-boot:run', '-Dspring-boot.run.profiles=dev'],
    });
  });
  it('does not detect Spring Boot from comments', async () => {
    const deps = setup('maven');
    deps.fs.seed(folder + '\\pom.xml', '<project><!-- spring-boot-starter-parent --></project>');
    expect((await detectFolder(deps, 'g1', folder)).commands).toHaveLength(3);
  });
});
