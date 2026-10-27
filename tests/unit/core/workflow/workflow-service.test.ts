import { describe, expect, it, vi } from 'vitest';
import { WorkflowService } from '../../../../src/core/workflow/workflow-service';
import { emptyWorkflow, type SnapshotManifest, type WorkflowData } from '../../../../src/core/workflow/types';
import type { WorkflowDependencies } from '../../../../src/core/workflow/ports';
import type { Task } from '../../../../src/core/persistence/state-schema';
import { execution } from '../../../support/renderer-fixtures';
function setup() {
  let stored = emptyWorkflow(),
    next = 0;
  const exec = execution('e1', { taskId: 't1', worktreePath: '/repo', status: 'exited', launchCount: 0 });
  const task: Task = {
    id: 't1',
    groupId: 'g1',
    title: 'Task',
    prompt: 'Fix the button',
    repoPath: '/repo',
    repoId: 'repo',
    baseRef: 'HEAD',
    baseCommit: '',
    slug: 'task',
    createdAt: new Date().toISOString(),
    isolation: 'direct',
  };
  let current: SnapshotManifest = {
    folders: [{ root: '/repo', files: [] }],
    fingerprint: 'before',
    scope: 'fixture',
  };
  const deps: WorkflowDependencies = {
    store: {
      load: async () => structuredClone(stored),
      save: vi.fn(async (value: WorkflowData) => {
        stored = structuredClone(value);
      }),
    },
    files: {
      capture: vi.fn(async () => structuredClone(current)),
      inspect: vi.fn(async () => structuredClone(current)),
      compare: vi.fn(() => []),
      diff: vi.fn(),
      restore: vi.fn(async () => undefined),
      overlaps: (a, b) => a === b,
    },
    executions: {
      execution: (id) => (id === 'e1' ? exec : undefined),
      task: (id) => (id === 't1' ? task : undefined),
      executions: () => [exec],
      groupExists: (id) => id === 'g1',
      validatePick: vi.fn(async () => undefined),
      launch: vi.fn(async () => [{ ok: true as const, execId: 'e2', agentId: 'codex' }]),
      stopAndWait: vi.fn(async () => {
        exec.status = 'exited';
      }),
      verify: vi.fn(async () => ({ taskId: 'command-task', execId: 'command', reused: false })),
      cancelVerify: vi.fn(async () => undefined),
      verificationLabel: () => 'Build',
    },
    id: () => 'id-' + ++next,
    now: () => new Date().toISOString(),
    changed: vi.fn(),
    notify: vi.fn(),
  };
  const service = new WorkflowService(deps);
  return {
    service,
    deps,
    exec,
    task,
    stored: () => stored,
    change: (fingerprint: string) => {
      current = { ...current, fingerprint };
    },
  };
}
describe('task workflow', () => {
  it('creates a checkpoint before launch and honors explicit opt-out', async () => {
    const f = setup();
    await f.service.load();
    await f.service.beforeAgentStart(f.exec);
    expect(f.service.snapshot().checkpoints[0]?.reason).toBe('before-launch');
    await f.service.prepareTask('t1', { objective: 'Fix', checkpointBeforeLaunch: false });
    await f.service.beforeAgentStart(f.exec);
    expect(f.service.snapshot().checkpoints).toHaveLength(1);
  });
  it('scopes profiles to their workspace and persists editable notes independently of the initial prompt', async () => {
    const f = setup();
    await f.service.load();
    const p = await f.service.saveProfile({
      id: '',
      name: 'Review',
      groupId: 'g1',
      agentId: 'claude',
      model: null,
      permission: null,
      instructions: 'Read only',
      checkpointBeforeLaunch: true,
    });
    expect(() => f.service.getProfile(p.id, 'other')).toThrow(/não disponível/);
    await f.service.saveNotes('t1', {
      objective: 'Reviewed goal',
      decisions: 'Use existing component',
      pending: 'Check keyboard',
      constraints: 'No push',
    });
    expect(f.task.prompt).toBe('Fix the button');
    expect(f.stored().tasks[0]?.notes.objective).toBe('Reviewed goal');
  });
  it('requires no live processes, rechecks preview and saves a safety checkpoint before restoring', async () => {
    const f = setup();
    await f.service.load();
    const cp = await f.service.checkpoint('e1', 'initial');
    f.exec.status = 'running';
    await expect(f.service.previewRestore(cp.id)).rejects.toThrow(/Encerre/);
    f.exec.status = 'exited';
    const preview = await f.service.previewRestore(cp.id);
    f.change('changed');
    await expect(f.service.restore(preview.id)).rejects.toThrow(/mudaram desde/);
    expect(f.deps.files.restore).not.toHaveBeenCalled();
    const current = await f.service.previewRestore(cp.id);
    const safety = await f.service.restore(current.id);
    expect(safety.reason).toBe('before-restore');
    expect(f.deps.files.restore).toHaveBeenCalledOnce();
  });
  it('builds a reviewable handoff without inventing decisions, tests or model memory', async () => {
    const f = setup();
    await f.service.load();
    const draft = await f.service.draftHandoff('e1');
    expect(draft).toContain('Fix the button');
    expect(draft).toContain('Nenhuma verificação registrada');
    expect(draft).toContain('não uma transferência do histórico');
    f.exec.status = 'running';
    await f.service.handoff({
      executionId: 'e1',
      briefing: draft + '\nUser reviewed.',
      pick: { agentId: 'codex' },
      size: { cols: 100, rows: 30 },
    });
    expect(f.deps.executions.stopAndWait).toHaveBeenCalledWith('e1');
    expect(f.deps.executions.launch).toHaveBeenCalledWith(
      't1',
      { agentId: 'codex' },
      expect.stringContaining('User reviewed.'),
      { cols: 100, rows: 30 },
      expect.objectContaining({ fingerprint: 'before' }),
    );
    expect(f.service.snapshot().handoffs[0]?.targetExecutionId).toBe('e2');
  });
  it('marks successful process checks stale after files change', async () => {
    const f = setup();
    await f.service.load();
    const verification = await f.service.verify('e1', 'build', { cols: 100, rows: 30 });
    if ('needsConfirm' in verification) throw new Error('confirm');
    expect(verification.status).toBe('running');
    f.change('after');
    expect((await f.service.review('e1')).verifications[0]?.stale).toBe(true);
  });
  it('labels quiet signals as estimates and only emits them when enabled', async () => {
    const f = setup();
    await f.service.load();
    f.exec.status = 'running';
    await f.service.idle('e1');
    expect(f.deps.notify).not.toHaveBeenCalled();
    await f.service.preferences({
      checkpointBeforeLaunch: true,
      desktopNotifications: false,
      quietNotifications: true,
    });
    await f.service.idle('e1');
    await f.service.idle('e1');
    expect(f.deps.notify).toHaveBeenCalledTimes(1);
    expect(f.service.snapshot().notices[0]?.text).toContain('estimativa');
  });
});
