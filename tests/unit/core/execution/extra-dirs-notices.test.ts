import { describe, expect, it } from 'vitest';
import type { Task } from '../../../../src/core/persistence/state-schema';
import { createFakeCore, FAKE_AGENTS } from '../../../support/fake-core';

const SIZE = { cols: 80, rows: 24 };

const WITH_DIRS = {
  ...FAKE_AGENTS.fake,
  id: 'fake-dirs',
  extraDirs: { style: 'repeat', args: ['--add-dir', '{dir}'] },
};
const WITH_JOIN = {
  ...FAKE_AGENTS.fake,
  id: 'fake-join',
  extraDirs: { style: 'join', separator: ',', args: ['--include-directories', '{dirs}'] },
};

function setup() {
  const core = createFakeCore();
  core.fs.seed(
    '/app/catalog/agents.json',
    JSON.stringify({ schemaVersion: 1, agents: [...Object.values(FAKE_AGENTS), WITH_DIRS, WITH_JOIN] }),
  );
  for (const dir of ['/w/main', '/w/b', '/w/c', '/w/com,virgula', '/w/solo']) core.fs.seed(`${dir}/f.txt`, '');
  return core;
}

async function workspaceTask(
  core: ReturnType<typeof setup>,
  folders: string[],
): Promise<Task> {
  const ws = await core.workspace.createWorkspace('Multi', folders);
  return core.workspace.createTask({
    groupId: ws.id,
    repoPath: folders[0] ?? '',
    baseRef: 'HEAD',
    prompt: '',
    isolation: 'direct',
  });
}

describe('lançamento com pastas extras', () => {
  it('passes the extras, runs in the primary and records no notice when all are available', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b', '/w/c']);
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake-dirs' }], SIZE);
    expect(r?.ok).toBe(true);
    const spawn = core.host.spawns[0];
    expect(spawn?.cwd).toBe('/w/main');
    expect(spawn?.args).toEqual(
      expect.arrayContaining(['--add-dir', '/w/b', '--add-dir', '/w/c']),
    );
    expect(core.model.execution(r?.execId ?? '')?.notices).toBeUndefined();
    expect(core.log.records.find((e) => e.event === 'execution.extra_dirs')?.fields).toMatchObject({
      applied: 2,
      omitted: 0,
    });
  });

  it('an agent without extraDirs gets the "unsupported" notice and no folder argument', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b']);
    const [r] = await core.executions.launch(task.id, [{ agentId: 'bash' }], SIZE);
    expect(r?.ok).toBe(true);
    expect(core.host.spawns[0]?.args).toEqual([]);
    expect(core.model.execution(r?.execId ?? '')?.notices).toEqual([{ kind: 'extra-dirs-unsupported' }]);
    expect(core.log.records.find((e) => e.event === 'execution.extra_dirs')?.fields).toMatchObject({
      applied: 0,
      omitted: 1,
    });
  });

  it('a one-folder workspace never produces a notice', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/solo']);
    expect(task.extraDirs).toBeUndefined();
    const [r] = await core.executions.launch(task.id, [{ agentId: 'bash' }], SIZE);
    expect(core.model.execution(r?.execId ?? '')?.notices).toBeUndefined();
    expect(core.log.records.some((e) => e.event === 'execution.extra_dirs')).toBe(false);
  });

  it('omits an unavailable extra and records how many were left out', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b', '/w/c']);
    core.fs.failOn('stat', '/w/c', 'ENOENT');
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake-dirs' }], SIZE);
    expect(r?.ok).toBe(true);
    const args = core.host.spawns[0]?.args ?? [];
    expect(args).toContain('/w/b');
    expect(args).not.toContain('/w/c');
    expect(core.model.execution(r?.execId ?? '')?.notices).toEqual([{ kind: 'extra-dirs-omitted', count: 1 }]);
  });

  it('counts an extra without read permission as unavailable', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b']);
    core.fs.failOn('readdir', '/w/b', 'EACCES');
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake-dirs' }], SIZE);
    expect(r?.ok).toBe(true);
    expect(core.host.spawns[0]?.args).not.toContain('/w/b');
    expect(core.model.execution(r?.execId ?? '')?.notices).toEqual([{ kind: 'extra-dirs-omitted', count: 1 }]);
  });

  it('join style: a folder whose path has the separator is omitted and reported', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b', '/w/com,virgula']);
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake-join' }], SIZE);
    expect(r?.ok).toBe(true);
    expect(core.host.spawns[0]?.args).toContain('/w/b');
    expect(core.host.spawns[0]?.args).not.toContain('/w/com,virgula');
    expect(core.model.execution(r?.execId ?? '')?.notices).toEqual([{ kind: 'extra-dirs-omitted', count: 1 }]);
  });

  it('refuses to launch when the primary folder is unavailable', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b']);
    core.fs.failOn('stat', '/w/main', 'ENOENT');
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake-dirs' }], SIZE);
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'INPUT_INVALID', message: 'A pasta principal /w/main não está disponível.' },
    });
    expect(core.host.spawns).toHaveLength(0);
  });

  it('createTask refuses an unavailable primary folder with the same message', async () => {
    const core = setup();
    const ws = await core.workspace.createWorkspace('Multi', ['/w/main', '/w/b']);
    core.fs.failOn('stat', '/w/main', 'ENOENT');
    await expect(
      core.workspace.createTask({
        groupId: ws.id,
        repoPath: '/w/main',
        baseRef: 'HEAD',
        prompt: '',
        isolation: 'direct',
      }),
    ).rejects.toMatchObject({ userMessage: 'A pasta principal /w/main não está disponível.' });
  });

  it('a relaunch omits a snapshot folder that vanished and warns', async () => {
    const core = setup();
    const task = await workspaceTask(core, ['/w/main', '/w/b', '/w/c']);
    const [r] = await core.executions.launch(task.id, [{ agentId: 'fake-dirs' }], SIZE);
    const execId = r?.execId ?? '';
    expect(core.model.execution(execId)?.notices).toBeUndefined();
    core.model.mutate((s) => {
      const e = s.executions.find((x) => x.id === execId);
      if (e) e.status = 'exited';
    });
    core.fs.failOn('stat', '/w/b', 'ENOENT');
    await core.executions.relaunch(execId, SIZE);
    const second = core.host.spawns[1]?.args ?? [];
    expect(second).toContain('/w/c');
    expect(second).not.toContain('/w/b');
    expect(core.model.execution(execId)?.notices).toEqual([{ kind: 'extra-dirs-omitted', count: 1 }]);
  });
});
