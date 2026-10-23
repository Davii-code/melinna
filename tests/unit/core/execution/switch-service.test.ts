import { describe, expect, it } from 'vitest';
import {
  emptyState,
  type Execution,
  type StateFile,
  type Task,
} from '../../../../src/core/persistence/state-schema';
import { createFakeCore } from '../../../support/fake-core';

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    groupId: 'g1',
    title: 'dev',
    prompt: '',
    repoPath: '/repo',
    repoId: 'abcdef0123456789',
    baseRef: '',
    baseCommit: '',
    slug: 'dev',
    createdAt: '2026-03-01T10:00:00.000Z',
    isolation: 'direct',
    ...over,
  };
}

function execution(id: string, taskId: string, over: Partial<Execution> = {}): Execution {
  return {
    id,
    taskId,
    agentId: 'fake',
    bandIndex: 0,
    model: null,
    permissionMode: null,
    branch: '',
    worktreePath: '/repo',
    baseCommit: '',
    status: 'running',
    pendingSwitch: null,
    pid: 1,
    exitCode: null,
    signal: null,
    startedAt: null,
    endedAt: null,
    launchCount: 1,
    failure: null,
    ...over,
  };
}

const COMMAND = { commandId: 'c1', label: 'dev', file: '/bin/node', args: ['server.js'] };

function state(): StateFile {
  const s = emptyState();
  s.groups.push({
    id: 'g1',
    name: 'App',
    order: 0,
    folders: [{ id: 'f1', path: '/repo' }],
    primaryFolderId: 'f1',
    repoPath: '/repo',
  });
  s.tasks.push(task('t-cmd', { kind: 'command' }));
  s.executions.push(execution('e-cmd', 't-cmd', { agentId: 'command', command: COMMAND }));
  return s;
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err as { code: string; userMessage: string };
  }
  throw new Error('esperava falha');
}

describe('command executions and the switch service', () => {
  it('refuses a model switch with the contract message', async () => {
    const core = createFakeCore(state());
    const err = await failure(core.executions.requestSwitch('e-cmd', 'model', 'esperto'));
    expect(err.code).toBe('SWITCH_UNSUPPORTED');
    expect(err.userMessage).toBe('Comandos não trocam de modelo nem de modo.');
  });

  it('refuses a mode switch the same way', async () => {
    const core = createFakeCore(state());
    const err = await failure(core.executions.requestSwitch('e-cmd', 'permission', 'livre'));
    expect(err.code).toBe('SWITCH_UNSUPPORTED');
  });

  it('decides by the command, not by the agent id', async () => {
    const s = state();
    s.executions.push(execution('e-odd', 't-cmd', { agentId: 'fake', command: COMMAND }));
    const core = createFakeCore(s);
    expect((await failure(core.executions.requestSwitch('e-odd', 'model', 'esperto'))).code).toBe(
      'SWITCH_UNSUPPORTED',
    );
  });
});

describe('removing a workspace with a live command', () => {
  it('refuses with "Pare o comando antes."', async () => {
    const core = createFakeCore(state());
    const err = await failure(core.executions.removeTasksOf('g1'));
    expect(err.code).toBe('EXECUTION_RUNNING');
    expect(err.userMessage).toBe('Pare o comando antes.');
  });

  it('keeps the old message when only agents are live', async () => {
    const s = emptyState();
    s.groups.push({ id: 'g1', name: 'App', order: 0 });
    s.tasks.push(task('t1'));
    s.executions.push(execution('e1', 't1'));
    const err = await failure(createFakeCore(s).executions.removeTasksOf('g1'));
    expect(err.code).toBe('EXECUTION_RUNNING');
    expect(err.userMessage).toBe('Pare as sessões do workspace antes de removê-lo.');
  });

  it('removes the workspace tasks once the command stopped', async () => {
    const s = state();
    const e = s.executions[0] as Execution;
    e.status = 'exited';
    e.exitCode = 0;
    const core = createFakeCore(s);
    await core.executions.removeTasksOf('g1');
    expect(core.model.raw.tasks).toEqual([]);
    expect(core.model.raw.executions).toEqual([]);
  });
});
