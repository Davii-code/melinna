import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempRepo, type TempRepo } from '../../../support/git-fixture';
import { makeGitService, type GitServiceRig } from '../../../support/git-service-rig';

let repo: TempRepo;
let rig: GitServiceRig;

beforeEach(() => {
  repo = createTempRepo({ generatedFiles: 500 });
  rig = makeGitService();
});

afterEach(() => {
  repo.cleanup();
  rig.cleanup();
});

describe('GitService.status performance', () => {
  it('lists 500 changed files in under 2 seconds', async () => {
    for (let i = 0; i < 500; i++) writeFileSync(join(repo.root, 'gen', `f${i}.txt`), `alterado ${i}\n`);
    const started = Date.now();
    const status = await rig.service.status(repo.root);
    const elapsed = Date.now() - started;
    expect(status.changes).toHaveLength(500);
    expect(status.changes.every((c) => c.kind === 'modified')).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
