import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import { RunBar } from '../../../src/renderer/components/Run/RunBar';
import { createRunStore } from '../../../src/renderer/store/run-store';
import type {
  ActiveRunRef,
  Group,
  RunCommand,
  RunConfigView,
  RunWarning,
  Task,
  WorkspaceSnapshot,
} from '../../../src/shared/ipc-contract';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { execution, runCommand, runConfig } from '../../support/renderer-fixtures';

const SIZE = { cols: 100, rows: 30 };

const group: Group = {
  id: 'g1',
  name: 'App',
  order: 0,
  folders: [
    { id: 'f1', path: '/repo' },
    { id: 'f2', path: '/repo/api' },
  ],
  primaryFolderId: 'f1',
};

const commandTask = (over: Partial<Task> = {}): Task => ({
  id: 't-cmd',
  groupId: 'g1',
  title: 'dev',
  prompt: '',
  repoPath: '/repo',
  repoId: 'r',
  baseRef: '',
  baseCommit: '',
  slug: 'dev',
  createdAt: '2026-10-23T10:00:00.000Z',
  isolation: 'direct',
  kind: 'command',
  ...over,
});

const runningExec = (over = {}) =>
  execution('e-cmd', {
    taskId: 't-cmd',
    agentId: 'command',
    model: null,
    permissionMode: null,
    status: 'running',
    command: { commandId: 'c1', label: 'dev', file: '/bin/npm', args: ['run', 'dev'] },
    ...over,
  });

interface Options {
  configs?: RunConfigView[];
  detected?: RunCommand[];
  warnings?: RunWarning[];
  active?: ActiveRunRef | null;
  snap?: WorkspaceSnapshot;
}

async function setup(opts: Options = {}) {
  const configs = opts.configs ?? [
    runConfig({ id: 'c0', name: 'Servidor', tool: 'program', script: null, program: 'node' }),
    runConfig({ id: 'c1', name: 'dev' }),
    runConfig({ id: 'c2', name: 'test', script: 'test' }),
  ];
  const snap = opts.snap ?? snapshot({ groups: [group] });
  const api = fakeApi();
  api.run.list.mockImplementation(() =>
    okR({ configs, detected: opts.detected ?? [], warnings: opts.warnings ?? [] }),
  );
  api.prefs.get.mockImplementation(() =>
    okR({ keymap: 'windows' as const, activeRun: opts.active ?? null, readOnly: false }),
  );
  const open = vi.fn();
  const onError = vi.fn();
  const store = createRunStore({
    api,
    layout: { open },
    workspace: { get: () => snap },
    size: SIZE,
    onError,
  });
  await store.load();
  render(
    <ApiContext.Provider value={api}>
      <RunBar store={store} snapshot={snap} />
    </ApiContext.Provider>,
  );
  return { api, store, open, onError };
}

const play = () => screen.getByRole('button', { name: 'Rodar' }) as HTMLButtonElement;
const selector = () => screen.getByRole('button', { name: /Configuração de execução/ });
const more = () => screen.getByRole('button', { name: 'Mais ações de execução' });

describe('RunBar', () => {
  it('shows "Nenhuma configuração ativa" and a disabled play button when none is chosen', async () => {
    await setup();
    expect(selector().textContent).toContain('Nenhuma configuração ativa');
    expect(play().disabled).toBe(true);
    expect(play().title).toBe('Escolha uma configuração');
  });

  it('shows the active configuration with its tool icon', async () => {
    await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    expect(selector().textContent).toContain('dev');
    expect(within(selector()).getByTestId('run-tool-icon').getAttribute('data-tool')).toBe('npm');
    expect(play().disabled).toBe(false);
  });

  it('says "Nenhuma configuração ativa" when the active one is gone, without rewriting the preference', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'sumiu' } });
    expect(selector().textContent).toContain('Nenhuma configuração ativa');
    expect(play().disabled).toBe(true);
    expect(api.prefs.setActiveRun).not.toHaveBeenCalled();
  });

  it('runs the active configuration and opens its panel', async () => {
    const { api, open } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    api.run.start.mockImplementation(() => okR({ taskId: 't9', execId: 'e9', reused: false }));
    fireEvent.click(play());
    await waitFor(() => expect(open).toHaveBeenCalledWith('e9'));
    expect(api.run.start).toHaveBeenCalledWith('g1', 'c1', SIZE, undefined);
  });

  it('focuses the existing panel when the configuration was already running', async () => {
    const { api, open } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    api.run.start.mockImplementation(() => okR({ taskId: 't9', execId: 'e-old', reused: true }));
    fireEvent.click(play());
    await waitFor(() => expect(open).toHaveBeenCalledWith('e-old'));
  });

  it('reports a start error through onError and opens nothing', async () => {
    const { api, open, onError } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    api.run.start.mockImplementation(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'PROGRAM_NOT_FOUND' as const, message: 'Programa não encontrado: npm.' },
      }),
    );
    fireEvent.click(play());
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'PROGRAM_NOT_FOUND' })),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('disables play with the reason when the active configuration is unavailable', async () => {
    await setup({
      active: { groupId: 'g1', commandId: 'c1' },
      configs: [
        runConfig({ id: 'c1', available: false, unavailableReason: 'program-missing', searched: 'mvn' }),
      ],
    });
    expect(play().disabled).toBe(true);
    expect(play().title).toBe('não encontrado: mvn');
  });

  it('shows a running indicator for the active configuration', async () => {
    await setup({
      active: { groupId: 'g1', commandId: 'c1' },
      snap: snapshot({ groups: [group], tasks: [commandTask()], executions: [runningExec()] }),
    });
    expect(screen.getByTestId('run-running')).toBeTruthy();
  });

  it('shows no running indicator when the execution ended', async () => {
    await setup({
      active: { groupId: 'g1', commandId: 'c1' },
      snap: snapshot({
        groups: [group],
        tasks: [commandTask()],
        executions: [runningExec({ status: 'exited', exitCode: 0 })],
      }),
    });
    expect(screen.queryByTestId('run-running')).toBeNull();
  });
});

describe('RunBar — selector', () => {
  it('opens the list of saved configs grouped by workspace and tool and chooses one', async () => {
    const { api } = await setup();
    fireEvent.click(selector());
    const list = screen.getByRole('listbox', { name: 'Configurações de execução' });
    expect(within(list).getByText('App')).toBeTruthy();
    fireEvent.click(within(list).getByRole('option', { name: /test/ }));
    await waitFor(() =>
      expect(api.prefs.setActiveRun).toHaveBeenCalledWith({ groupId: 'g1', commandId: 'c2' }),
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(selector().textContent).toContain('test');
    expect(play().disabled).toBe(false);
  });

  it('refreshes the configs when the selector opens', async () => {
    const { api } = await setup();
    const before = api.run.list.mock.calls.length;
    fireEvent.click(selector());
    await waitFor(() => expect(api.run.list.mock.calls.length).toBe(before + 1));
  });
});

describe('RunBar — wrapper without the execute bit', () => {
  async function confirmSetup() {
    const ctx = await setup({
      active: { groupId: 'g1', commandId: 'c1' },
      configs: [
        runConfig({
          id: 'c1',
          name: 'Maven: compile',
          tool: 'maven',
          script: 'compile',
          program: '/repo/mvnw',
        }),
      ],
    });
    ctx.api.run.start.mockImplementationOnce(() =>
      okR({ needsConfirm: 'wrapper-sh' as const, wrapper: '/repo/mvnw' }),
    );
    fireEvent.click(play());
    await screen.findByRole('alertdialog');
    return ctx;
  }

  it('asks before running and starts nothing yet', async () => {
    const { api, open } = await confirmSetup();
    expect(screen.getByRole('alertdialog').textContent).toContain('/repo/mvnw');
    expect(api.run.start).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it('runs with sh when the user accepts', async () => {
    const { api, open } = await confirmSetup();
    api.run.start.mockImplementationOnce(() => okR({ taskId: 't', execId: 'e-sh', reused: false }));
    fireEvent.click(screen.getByRole('button', { name: /Rodar com sh/ }));
    await waitFor(() => expect(api.run.start).toHaveBeenLastCalledWith('g1', 'c1', SIZE, 'wrapper-sh'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('e-sh'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('uses the system tool when the user declines', async () => {
    const { api, open } = await confirmSetup();
    api.run.start.mockImplementationOnce(() => okR({ taskId: 't', execId: 'e-sys', reused: false }));
    fireEvent.click(screen.getByRole('button', { name: /Usar .* do sistema/ }));
    await waitFor(() => expect(api.run.start).toHaveBeenLastCalledWith('g1', 'c1', SIZE, 'system-tool'));
    await waitFor(() => expect(open).toHaveBeenCalledWith('e-sys'));
  });

  it('cancels without starting anything', async () => {
    const { api } = await confirmSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.run.start).toHaveBeenCalledTimes(1);
  });
});

describe('RunBar — menu', () => {
  const live = () => snapshot({ groups: [group], tasks: [commandTask()], executions: [runningExec()] });

  it('disables "Rodar de novo" and "Parar" while the active one is stopped, keeps "Editar configurações"', async () => {
    await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    fireEvent.click(more());
    expect((screen.getByRole('menuitem', { name: 'Rodar de novo' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('menuitem', { name: 'Parar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('menuitem', { name: 'Editar configurações' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('keeps only "Editar configurações" enabled with no active configuration', async () => {
    await setup();
    fireEvent.click(more());
    expect((screen.getByRole('menuitem', { name: 'Parar' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('menuitem', { name: 'Editar configurações' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('reruns the live execution of the active configuration and focuses its panel', async () => {
    const { api, open } = await setup({ active: { groupId: 'g1', commandId: 'c1' }, snap: live() });
    fireEvent.click(more());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rodar de novo' }));
    await waitFor(() => expect(api.run.rerun).toHaveBeenCalledWith('e-cmd', SIZE));
    expect(open).toHaveBeenCalledWith('e-cmd');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stops the live execution through executions.stop', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'c1' }, snap: live() });
    fireEvent.click(more());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Parar' }));
    await waitFor(() => expect(api.executions.stop).toHaveBeenCalledWith('e-cmd'));
  });

  it('opens the configuration dialog from "Editar configurações"', async () => {
    await setup();
    fireEvent.click(more());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar configurações' }));
    expect(await screen.findByRole('dialog', { name: 'Configurações de execução' })).toBeTruthy();
  });
});

describe('RunBar — adicionar a partir de um script detectado', () => {
  const detected = [
    runCommand({ id: 'd1', label: 'lint', args: ['run', 'lint'] }),
    runCommand({ id: 'd2', label: 'build', args: ['run', 'build'] }),
  ];

  it('opens the picker from the selector, creates the config, makes it active and lists it', async () => {
    const { api, store } = await setup({ detected, configs: [runConfig({ id: 'c1', name: 'dev' })] });
    api.run.saveConfig.mockImplementation((groupId, input) => {
      const view = runConfig({ ...input, id: 'novo', groupId });
      api.run.list.mockImplementation(() =>
        okR({ configs: [runConfig({ id: 'c1', name: 'dev' }), view], detected, warnings: [] }),
      );
      return okR(view);
    });
    fireEvent.click(selector());
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar a partir de um script detectado…' }));
    const picker = screen.getByRole('dialog', { name: 'Scripts detectados' });
    fireEvent.click(within(picker).getByRole('button', { name: /lint/ }));
    await waitFor(() =>
      expect(api.prefs.setActiveRun).toHaveBeenCalledWith({ groupId: 'g1', commandId: 'novo' }),
    );
    expect(api.run.saveConfig).toHaveBeenCalledWith(
      'g1',
      expect.objectContaining({ name: 'lint', tool: 'npm', script: 'lint' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Scripts detectados' })).toBeNull();
    expect(store.get().configs?.map((c) => c.id)).toEqual(['c1', 'novo']);
    await waitFor(() => expect(selector().textContent).toContain('lint'));
  });

  it('offers only the scripts of the active workspace', async () => {
    const other = runCommand({ id: 'x', groupId: 'g2', label: 'outro', folder: '/other' });
    await setup({ detected: [...detected, other] });
    fireEvent.click(selector());
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar a partir de um script detectado…' }));
    const picker = screen.getByRole('dialog', { name: 'Scripts detectados' });
    expect(within(picker).queryByRole('button', { name: /outro/ })).toBeNull();
    expect(within(picker).getByRole('button', { name: /lint/ })).toBeTruthy();
  });
});

describe('RunBar — antes de lançar', () => {
  const chain = () => [
    runConfig({ id: 'c1', name: 'dev', beforeLaunch: 'c9' }),
    runConfig({ id: 'c9', name: 'build', script: 'build' }),
  ];

  it('shows "Aguardando <etapa>…" while the launch waits for the step, and cancels it', async () => {
    const stepTask = commandTask({ id: 't-step', title: 'build' });
    const stepExec = execution('e-step', {
      taskId: 't-step',
      agentId: 'command',
      model: null,
      permissionMode: null,
      status: 'running',
      command: { commandId: 'c9', label: 'build', file: '/bin/npm', args: ['run', 'build'] },
    });
    const { api } = await setup({
      configs: chain(),
      active: { groupId: 'g1', commandId: 'c1' },
      snap: snapshot({ groups: [group], tasks: [stepTask], executions: [stepExec] }),
    });
    api.run.start.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(play());
    const bar = await screen.findByTestId('run-waiting-bar');
    expect(bar.textContent).toContain('Aguardando build…');
    fireEvent.click(within(bar).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(api.executions.stop).toHaveBeenCalledWith('e-step'));
  });

  it('shows nothing when the config has no step', async () => {
    const { api } = await setup({ active: { groupId: 'g1', commandId: 'c1' } });
    api.run.start.mockImplementation(() => new Promise(() => undefined));
    fireEvent.click(play());
    expect(screen.queryByTestId('run-waiting-bar')).toBeNull();
  });
});
