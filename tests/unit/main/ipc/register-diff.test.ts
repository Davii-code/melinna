import { describe, expect, it } from 'vitest';
import { DiffService } from '../../../../src/core/git/diff';
import { registerDiff } from '../../../../src/main/ipc/register-diff';
import { BASE_SHA, createFakeCore, handleRecorder } from '../../../support/fake-core';
import { ok } from '../../../support/fakes/process-runner';

const DIFF = ['diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

async function setup() {
  const core = createFakeCore();
  const rec = handleRecorder();
  const diff = new DiffService({ model: core.model, git: core.git, fs: core.fs, os: 'linux', log: core.log });
  registerDiff(rec.handle, { diff, executions: core.executions, model: core.model, log: core.log });
  const g = await core.workspace.createGroup('G');
  const task = await core.workspace.createTask({ groupId: g.id, repoPath: '/repo', baseRef: 'main', prompt: 'X' });
  const [r] = await core.executions.launch(task.id, [{ agentId: 'fake' }], { cols: 80, rows: 24 });
  if (!r?.ok) throw new Error('lançamento falhou');
  core.fs.seed(`${core.model.execution(r.execId)!.worktreePath}/a.txt`, 'y\n');
  return { core, rec, execId: r.execId };
}

describe('diff IPC', () => {
  it('registers the diff channels', async () => {
    expect((await setup()).rec.channels()).toEqual(['executions:diff', 'executions:divergence']);
  });

  it('returns the parsed diff against the base commit', async () => {
    const { rec, core, execId } = await setup();
    core.runner.prepend((_f, args) => (args.includes('diff') && args.includes(BASE_SHA) ? ok(DIFF) : undefined));
    const r = await rec.call('executions:diff', execId);
    expect(r).toMatchObject({ ok: true, value: { files: [{ path: 'a.txt', change: 'modified', lineCount: 2 }] } });
    const call = core.runner.calls.find((c) => c.args.includes('diff'));
    expect(call?.opts.cwd).toBe(core.model.execution(execId)?.worktreePath);
    expect(call?.args).toContain('--no-optional-locks');
  });

  it('returns how many commits the base advanced', async () => {
    const { rec, core, execId } = await setup();
    core.runner.prepend((_f, args) => (args.includes('rev-list') ? ok('4\n') : undefined));
    expect(await rec.call('executions:divergence', execId)).toEqual({ ok: true, value: { baseAdvancedBy: 4 } });
  });

  it('validates the execution id', async () => {
    const { rec } = await setup();
    expect((await rec.call('executions:diff', 'nao-existe')).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('executions:divergence', 12)).error?.code).toBe('INPUT_INVALID');
    expect((await rec.call('executions:diff')).error?.code).toBe('INPUT_INVALID');
  });
});
