import { describe, expect, it, vi } from 'vitest';
import {
  configOf,
  createRunStore,
  inputFromDetected,
  runningKeys,
  stepsOf,
} from '../../../src/renderer/store/run-store';
import type { ActiveRunRef, RunConfigView, WorkspaceSnapshot } from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { execution, runCommand, runConfig } from '../../support/renderer-fixtures';

const SIZE = { cols: 100, rows: 30 };

async function setup(
  opts: { configs?: RunConfigView[]; active?: ActiveRunRef | null; snap?: WorkspaceSnapshot } = {},
) {
  const api = fakeApi();
  let configs = opts.configs ?? [runConfig({ id: 'c1', name: 'dev' }), runConfig({ id: 'c2', name: 'test' })];
  const detected = [runCommand({ id: 'd1', label: 'build', args: ['run', 'build'] })];
  api.run.list.mockImplementation(() => okR({ configs, detected, warnings: [] }));
  api.prefs.get.mockImplementation(() =>
    okR({ keymap: 'windows' as const, activeRun: opts.active ?? null, readOnly: false }),
  );
  const open = vi.fn();
  const onError = vi.fn();
  const snap = opts.snap ?? snapshot();
  const store = createRunStore({
    api,
    layout: { open },
    workspace: { get: () => snap },
    size: SIZE,
    onError,
  });
  await store.load();
  return { api, store, open, onError, setConfigs: (c: RunConfigView[]) => (configs = c) };
}

describe('run store — configs', () => {
  it('loads the saved configs, the detected scripts and the active one', async () => {
    const { store } = await setup({ active: { groupId: 'g1', commandId: 'c2' } });
    const state = store.get();
    expect(state.configs?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(state.detected.map((c) => c.id)).toEqual(['d1']);
    expect(state.active).toEqual({ groupId: 'g1', commandId: 'c2' });
  });

  it('starts empty and not loaded: configs is null until the first read', () => {
    const store = createRunStore({
      api: fakeApi(),
      layout: { open: vi.fn() },
      workspace: { get: () => null },
      size: SIZE,
      onError: vi.fn(),
    });
    expect(store.get().configs).toBeNull();
  });

  it('keeps the active one after a save', async () => {
    const { store, api } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    const saved = await store.save('g1', {
      name: 'dev',
      tool: 'npm',
      folder: '/repo',
      script: 'dev',
      program: '',
      args: [],
      runtimeOptions: '',
      env: [{ name: 'PORT', value: '4000' }],
      beforeLaunch: null,
      allowParallel: false,
      folderGroup: null,
      id: 'c1',
    });
    expect(saved?.id).toBe('c1');
    expect(api.run.saveConfig).toHaveBeenCalledTimes(1);
    expect(api.run.list).toHaveBeenCalledTimes(2);
    expect(store.get().active).toEqual({ groupId: 'g1', commandId: 'c1' });
    expect(api.prefs.setActiveRun).not.toHaveBeenCalled();
  });

  it('reports a save error through onError and returns null', async () => {
    const { store, api, onError } = await setup();
    api.run.saveConfig.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'RUN_CONFIG_INVALID' as const, message: 'Já existe uma configuração com esse nome.' },
      }),
    );
    const saved = await store.save('g1', inputFromDetected(runCommand(), []));
    expect(saved).toBeNull();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'RUN_CONFIG_INVALID' }));
  });

  it('removes a config, clears the active one when it was it, and reloads', async () => {
    const { store, api, setConfigs } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    setConfigs([runConfig({ id: 'c2', name: 'test' })]);
    expect(await store.remove('g1', 'c1')).toBe(true);
    expect(api.run.removeConfig).toHaveBeenCalledWith('g1', 'c1');
    expect(api.prefs.setActiveRun).toHaveBeenCalledWith(null);
    expect(store.get().active).toBeNull();
    expect(store.get().configs?.map((c) => c.id)).toEqual(['c2']);
  });

  it('keeps the active one when another config is removed', async () => {
    const { store, api } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    await store.remove('g1', 'c2');
    expect(api.prefs.setActiveRun).not.toHaveBeenCalled();
    expect(store.get().active).toEqual({ groupId: 'g1', commandId: 'c1' });
  });

  it('shows the error and keeps everything when the removal is refused', async () => {
    const { store, api, onError } = await setup();
    api.run.removeConfig.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'RUN_CONFIG_RUNNING' as const, message: 'A configuração está rodando. Pare-a antes.' },
      }),
    );
    expect(await store.remove('g1', 'c1')).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reorders and reloads', async () => {
    const { store, api } = await setup();
    const items = [{ id: 'c1', folderGroup: 'Web', order: 0 }];
    expect(await store.reorder('g1', items)).toBe(true);
    expect(api.run.reorder).toHaveBeenCalledWith('g1', items);
    expect(api.run.list).toHaveBeenCalledTimes(2);
  });

  it('adds a config from a detected script, makes it active and lists it', async () => {
    const { store, api, setConfigs } = await setup();
    api.run.saveConfig.mockImplementation((groupId, input) => {
      const view = runConfig({ ...input, id: 'novo', groupId, available: true });
      setConfigs([...(store.get().configs ?? []), view]);
      return okR(view);
    });
    const added = await store.addFromDetected(
      runCommand({ id: 'd1', label: 'build', args: ['run', 'build'] }),
    );
    expect(api.run.saveConfig).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ name: 'build', tool: 'npm', script: 'build', folder: '/repo' }),
    );
    expect(added?.id).toBe('novo');
    expect(api.prefs.setActiveRun).toHaveBeenCalledWith({ groupId: 'g1', commandId: 'novo' });
    expect(store.get().active).toEqual({ groupId: 'g1', commandId: 'novo' });
    expect(store.get().configs?.map((c) => c.id)).toContain('novo');
  });
});

describe('inputFromDetected', () => {
  it('maps npm/pnpm/yarn to tool + script', () => {
    expect(
      inputFromDetected(runCommand({ tool: 'pnpm', label: 'dev', args: ['run', 'dev'] }), []),
    ).toMatchObject({
      tool: 'pnpm',
      script: 'dev',
      name: 'dev',
      args: [],
    });
  });

  it('maps maven goals and gradle tasks to the text of the objectives', () => {
    const mvn = runCommand({
      tool: 'maven',
      source: 'maven',
      label: 'Maven: test',
      program: 'mvn',
      args: ['test'],
    });
    expect(inputFromDetected(mvn, [])).toMatchObject({ tool: 'maven', script: 'test', name: 'Maven: test' });
    const gradle = runCommand({ tool: 'gradle', source: 'gradle', label: 'Gradle: build', args: ['build'] });
    expect(inputFromDetected(gradle, [])).toMatchObject({ tool: 'gradle', script: 'build' });
  });

  it('maps compose dropping the leading "compose" word', () => {
    const up = runCommand({
      tool: 'compose',
      source: 'compose',
      label: 'Compose: subir',
      program: 'docker',
      args: ['compose', 'up'],
    });
    expect(inputFromDetected(up, [])).toMatchObject({ tool: 'compose', script: null, args: ['up'] });
  });

  it('avoids a repeated name by adding the folder, then a copy suffix', () => {
    const cmd = runCommand({ label: 'dev', folder: '/repo/api' });
    expect(inputFromDetected(cmd, ['dev']).name).toBe('dev (api)');
    expect(inputFromDetected(cmd, ['dev', 'dev (api)']).name).toBe('dev (api) (cópia)');
  });
});

describe('helpers', () => {
  it('configOf finds the config of a ref and ignores a stale one', () => {
    const configs = [runConfig({ id: 'c1' })];
    expect(configOf(configs, { groupId: 'g1', commandId: 'c1' })?.id).toBe('c1');
    expect(configOf(configs, { groupId: 'g1', commandId: 'sumiu' })).toBeUndefined();
    expect(configOf(null, { groupId: 'g1', commandId: 'c1' })).toBeUndefined();
  });

  it('stepsOf lists the before-launch steps nearest first and stops at a cycle', () => {
    const a = runConfig({ id: 'a', beforeLaunch: 'b' });
    const b = runConfig({ id: 'b', beforeLaunch: 'c' });
    const c = runConfig({ id: 'c' });
    expect(stepsOf([a, b, c], a).map((s) => s.id)).toEqual(['b', 'c']);
    const loop = runConfig({ id: 'x', beforeLaunch: 'y' });
    const back = runConfig({ id: 'y', beforeLaunch: 'x' });
    expect(stepsOf([loop, back], loop).map((s) => s.id)).toEqual(['y']);
  });

  it('runningKeys lists the configs with a live execution', () => {
    const snap = snapshot({
      tasks: [
        {
          id: 't1',
          groupId: 'g1',
          title: 'dev',
          prompt: '',
          repoPath: '/repo',
          repoId: 'r',
          baseRef: '',
          baseCommit: '',
          slug: 'dev',
          createdAt: '2026-10-23T10:00:00.000Z',
        },
      ],
      executions: [
        execution('e1', {
          taskId: 't1',
          status: 'running',
          command: { commandId: 'c1', label: 'dev', file: '/bin/npm', args: [] },
        }),
        execution('e2', {
          taskId: 't1',
          status: 'exited',
          command: { commandId: 'c2', label: 'x', file: '/bin/npm', args: [] },
        }),
      ],
    });
    expect([...runningKeys(snap)]).toEqual(['g1:c1']);
  });
});

describe('run store — rodar', () => {
  it('runs the active config and opens the panel', async () => {
    const { store, api, open } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    api.run.start.mockImplementation(() => okR({ taskId: 't9', execId: 'e9', reused: false }));
    await store.run();
    expect(api.run.start).toHaveBeenCalledWith('g1', 'c1', SIZE, undefined);
    expect(open).toHaveBeenCalledWith('e9');
  });

  it('does not run an unavailable config', async () => {
    const { store, api } = await setup({
      configs: [runConfig({ id: 'c1', available: false, unavailableReason: 'program-missing' })],
      active: { groupId: 'g1', commandId: 'c1' },
    });
    await store.run();
    expect(api.run.start).not.toHaveBeenCalled();
  });

  it('refreshes after RUN_CONFIG_MISSING and COMMAND_STALE', async () => {
    const { store, api, onError } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    api.run.start.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'RUN_CONFIG_MISSING' as const, message: 'A configuração não existe mais.' },
      }),
    );
    await store.run();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(api.run.list).toHaveBeenCalledTimes(2);
  });

  it('stops the live before-launch steps of the active config when asked to cancel', async () => {
    const snap = snapshot({
      tasks: [
        {
          id: 't1',
          groupId: 'g1',
          title: 'build',
          prompt: '',
          repoPath: '/repo',
          repoId: 'r',
          baseRef: '',
          baseCommit: '',
          slug: 'build',
          createdAt: '2026-10-23T10:00:00.000Z',
        },
      ],
      executions: [
        execution('e-build', {
          taskId: 't1',
          status: 'running',
          command: { commandId: 'build', label: 'build', file: '/bin/npm', args: [] },
        }),
      ],
    });
    const { store, api } = await setup({
      configs: [runConfig({ id: 'dev', beforeLaunch: 'build' }), runConfig({ id: 'build', name: 'build' })],
      active: { groupId: 'g1', commandId: 'dev' },
      snap,
    });
    await store.cancelBeforeLaunch();
    expect(api.executions.stop).toHaveBeenCalledWith('e-build');
  });
});
