import { describe, expect, it } from 'vitest';
import { detectFolders } from '../../../../src/core/run/detect';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { fakePlatform } from '../../../support/fakes/platform';

describe('detection performance (SC-002)', () => {
  it('detects 10 folders with every kind of project file in under 1 second', async () => {
    const fs = new MemoryFileSystem();
    for (const bin of ['npm', 'pnpm', 'yarn', 'mvn', 'gradle', 'docker']) fs.seed(`/bin/${bin}`, 'bin');
    const targets = Array.from({ length: 10 }, (_, i) => ({ groupId: `g${i}`, folder: `/work/app${i}` }));
    for (const { folder } of targets) {
      fs.seed(`${folder}/package.json`, JSON.stringify({ scripts: { dev: 'x', build: 'x', test: 'x' } }));
      fs.seed(`${folder}/pom.xml`, '<project/>');
      fs.seed(`${folder}/build.gradle.kts`, 'plugins {\n    application\n}');
      fs.seed(`${folder}/compose.yaml`, 'services: {}');
    }
    const started = performance.now();
    const result = await detectFolders({ fs, platform: fakePlatform('linux', '/bin') }, targets);
    const elapsed = performance.now() - started;
    expect(result.commands).toHaveLength(10 * (3 + 3 + 3 + 2));
    expect(elapsed).toBeLessThan(1000);
  });
});
