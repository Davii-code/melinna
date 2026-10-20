import { describe, expect, it } from 'vitest';
import { ExecutionService } from '../../../../src/core/execution/execution-service';
import { emptyState, type Execution, type StateFile } from '../../../../src/core/persistence/state-schema';
import { createFakeCore } from '../../../support/fake-core';
import { FakeHostClient } from '../../../support/fakes/host-client';
import { execution } from '../../../support/renderer-fixtures';

function stateWith(execs: Execution[]): StateFile {
  return {
    ...emptyState(),
    groups: [{ id: 'g', name: 'G', order: 0 }],
    tasks: [
      {
        id: 't1',
        groupId: 'g',
        title: 't',
        prompt: 'p',
        repoPath: '/repo',
        repoId: 'r',
        baseRef: 'main',
        baseCommit: 'b'.repeat(40),
        slug: 't',
        createdAt: '',
      },
    ],
    executions: execs,
  };
}

describe('recovery', () => {
  it('reconciles with the host: alive stays running, ended becomes exited, missing becomes lost', async () => {
    const core = createFakeCore(
      stateWith([
        execution('vivo', { status: 'idle', agentId: 'fake' }),
        execution('saiu', { status: 'running', agentId: 'fake' }),
        execution('sumiu', { status: 'running', agentId: 'fake' }),
        execution('preparo', { status: 'preparing', agentId: 'fake' }),
        execution('antigo', { status: 'exited', exitCode: 1, agentId: 'fake' }),
      ]),
    );
    await core.host.spawn({
      execId: 'vivo',
      file: '/bin/fake',
      args: [],
      cwd: '/',
      env: {},
      cols: 80,
      rows: 24,
    });
    await core.host.spawn({
      execId: 'saiu',
      file: '/bin/fake',
      args: [],
      cwd: '/',
      env: {},
      cols: 80,
      rows: 24,
    });
    core.host.exit('saiu', 4);
    await core.executions.reconcileWithHost();
    const e = (id: string) => core.model.execution(id)!;
    expect(e('vivo')).toMatchObject({ status: 'running', pid: 1000 });
    expect(e('saiu')).toMatchObject({ status: 'exited', exitCode: 4, pid: null });
    expect(e('saiu').endedAt).toBeTruthy();
    expect(e('sumiu')).toMatchObject({ status: 'lost', pid: null, failure: { code: 'HOST_UNAVAILABLE' } });
    expect(e('preparo')).toMatchObject({ status: 'failed_to_start' });
    expect(e('antigo')).toMatchObject({ status: 'exited', exitCode: 1 });
  });

  it('without a host every live execution is lost', async () => {
    const core = createFakeCore(stateWith([execution('a', { status: 'running', agentId: 'fake' })]));
    const svc = new ExecutionService({
      model: core.model,
      catalog: core.catalog,
      git: core.git,
      fs: core.fs,
      mutex: core.mutex,
      paths: core.paths,
      os: 'linux',
      clock: core.clock,
      log: core.log,
      hosts: { get: async () => core.host, existing: async () => null },
      baseEnv: {},
    });
    await svc.reconcileWithHost();
    expect(core.model.execution('a')?.status).toBe('lost');
  });

  it('disconnected marks live executions as lost and the next launch asks for a new host', async () => {
    const core = createFakeCore();
    const hosts: FakeHostClient[] = [];
    const svc = new ExecutionService({
      model: core.model,
      catalog: core.catalog,
      git: core.git,
      fs: core.fs,
      mutex: core.mutex,
      paths: core.paths,
      os: 'linux',
      clock: core.clock,
      log: core.log,
      hosts: {
        get: async () => {
          const last = hosts.at(-1);
          if (last && !(last as FakeHostClient & { dead?: boolean }).dead) return last;
          const h = new FakeHostClient();
          hosts.push(h);
          return h;
        },
        existing: async () => hosts.at(-1) ?? null,
      },
      baseEnv: {},
    });
    const g = await core.workspace.createGroup('G');
    const t = await core.workspace.createTask({
      groupId: g.id,
      repoPath: '/repo',
      baseRef: 'main',
      prompt: 'p',
    });
    const [r] = await svc.launch(t.id, [{ agentId: 'fake' }], { cols: 80, rows: 24 });
    const first = hosts[0]!;
    (first as FakeHostClient & { dead?: boolean }).dead = true;
    first.disconnect();
    expect(core.model.execution(r!.execId!)).toMatchObject({
      status: 'lost',
      failure: { code: 'HOST_UNAVAILABLE' },
    });
    await svc.launch(t.id, [{ agentId: 'fake' }], { cols: 80, rows: 24 });
    expect(hosts).toHaveLength(2);
    expect(hosts[1]?.spawns).toHaveLength(1);
  });
});
