import { describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_TICK_MS,
  AutomationScheduler,
} from '../../../../src/core/automations/automation-scheduler';
import { AutomationStore } from '../../../../src/core/automations/automation-store';
import type { Automation, AutomationInput } from '../../../../src/core/automations/types';
import { MelinnaError } from '../../../../src/core/errors';
import { KeyedMutex } from '../../../../src/core/git/repo-mutex';
import { FakeClock } from '../../../support/fakes/clock';
import { MemoryFileSystem } from '../../../support/fakes/file-system';
import { MemoryLogger } from '../../../support/fakes/logger';

const MINUTE = 60_000;
/** Segunda-feira, 2 de março de 2026, 08:00 no horário local. */
const START = new Date(2026, 2, 2, 8, 0, 0, 0).getTime();

const INPUT: AutomationInput = {
  name: 'Relatório',
  folder: '/repos/site',
  agentId: 'claude',
  prompt: 'Gere o relatório.',
  schedule: { kind: 'interval', minutes: 10 },
  enabled: true,
  isolation: 'direct',
};

async function setup(
  seed: AutomationInput[] = [INPUT],
  opts: { before?: (store: AutomationStore, clock: FakeClock) => Promise<void> } = {},
) {
  const clock = new FakeClock(START);
  const log = new MemoryLogger();
  let n = 0;
  const store = new AutomationStore({
    fs: new MemoryFileSystem(),
    path: '/data/automations.json',
    clock,
    log,
    mutex: new KeyedMutex(),
    newId: () => `a${++n}`,
  });
  for (const input of seed) await store.save(input);
  await opts.before?.(store, clock);
  const launch = vi.fn(async (a: Automation) => ({ taskId: `task-${a.id}` }));
  const scheduler = new AutomationScheduler({ store, clock, log, launch });
  await scheduler.start();
  /** Avança o relógio tique a tique, deixando cada disparo terminar antes do próximo. */
  const advance = async (ms: number) => {
    for (let passed = 0; passed < ms; passed += AUTOMATION_TICK_MS) {
      clock.advance(Math.min(AUTOMATION_TICK_MS, ms - passed));
      for (let i = 0; i < 10; i++) await Promise.resolve();
    }
  };
  return { scheduler, store, clock, log, launch, advance };
}

describe('AutomationScheduler', () => {
  it('fires at the due time, records the launch and schedules the next one', async () => {
    const { scheduler, store, launch, advance } = await setup();
    expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 10 * MINUTE).toISOString());
    await advance(9 * MINUTE);
    expect(launch).not.toHaveBeenCalled();
    await advance(MINUTE);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch.mock.calls[0]?.[0]).toMatchObject({ id: 'a1', folder: '/repos/site', agentId: 'claude' });
    expect(store.get('a1')?.lastRun).toMatchObject({ status: 'launched', taskId: 'task-a1' });
    expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 20 * MINUTE).toISOString());
    await advance(10 * MINUTE);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('fires a daily automation at its local time', async () => {
    const { launch, advance } = await setup([
      { ...INPUT, schedule: { kind: 'daily', time: '08:05', days: [] } },
    ]);
    await advance(4 * MINUTE);
    expect(launch).not.toHaveBeenCalled();
    await advance(MINUTE);
    expect(launch).toHaveBeenCalledTimes(1);
    await advance(60 * MINUTE);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('records a time that passed while the app was closed as missed, without running it late', async () => {
    const { store, launch, scheduler, advance } = await setup([INPUT], {
      before: async (_store, clock) => clock.advance(25 * MINUTE),
    });
    const now = START + 25 * MINUTE;
    expect(store.get('a1')?.lastRun).toEqual({
      at: new Date(now).toISOString(),
      status: 'missed',
      detail: new Date(START + 20 * MINUTE).toISOString(),
    });
    expect(launch).not.toHaveBeenCalled();
    expect(scheduler.nextRunAt('a1')).toBe(new Date(now + 10 * MINUTE).toISOString());
    await advance(10 * MINUTE);
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('does not fire or report a next run for a disabled automation', async () => {
    const { scheduler, launch, advance } = await setup([{ ...INPUT, enabled: false }]);
    expect(scheduler.nextRunAt('a1')).toBeNull();
    await advance(30 * MINUTE);
    expect(launch).not.toHaveBeenCalled();
  });

  it('follows changes: new, re-enabled, rescheduled and removed automations', async () => {
    const { scheduler, store, launch, advance } = await setup([]);
    await store.save(INPUT);
    expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 10 * MINUTE).toISOString());
    await store.setEnabled('a1', false);
    expect(scheduler.nextRunAt('a1')).toBeNull();
    await advance(5 * MINUTE);
    await store.setEnabled('a1', true);
    expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 15 * MINUTE).toISOString());
    await store.save({ ...INPUT, id: 'a1', schedule: { kind: 'interval', minutes: 30 } });
    expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 35 * MINUTE).toISOString());
    await store.remove('a1');
    expect(scheduler.nextRunAt('a1')).toBeNull();
    await advance(60 * MINUTE);
    expect(launch).not.toHaveBeenCalled();
  });

  it('keeps the next run when only the name or the prompt changes', async () => {
    const { scheduler, store, advance } = await setup();
    await advance(4 * MINUTE);
    await store.save({ ...INPUT, id: 'a1', name: 'Novo nome', prompt: 'Outro enunciado.' });
    expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 10 * MINUTE).toISOString());
  });

  it('records why a launch failed and keeps going', async () => {
    const { store, launch, advance, log } = await setup();
    launch.mockRejectedValueOnce(new MelinnaError('LIMIT_REACHED'));
    await advance(10 * MINUTE);
    expect(store.get('a1')?.lastRun).toMatchObject({
      status: 'failed',
      detail: 'Limite de 12 execuções vivas atingido.',
    });
    launch.mockRejectedValueOnce(new Error('explodiu'));
    await advance(10 * MINUTE);
    expect(store.get('a1')?.lastRun?.detail).toBe('Erro interno ao abrir a sessão.');
    expect(log.events()).toContain('automations.launch_failed');
    await advance(10 * MINUTE);
    expect(store.get('a1')?.lastRun?.status).toBe('launched');
  });

  it('runs on demand without moving the schedule', async () => {
    const { scheduler, launch, store } = await setup([{ ...INPUT, enabled: false }]);
    const run = await scheduler.runNow('a1');
    expect(run).toMatchObject({ status: 'launched', taskId: 'task-a1' });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(store.get('a1')?.lastRun?.status).toBe('launched');
    expect(scheduler.nextRunAt('a1')).toBeNull();
    await expect(scheduler.runNow('nao-existe')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('does not open a second session while the first launch is still in progress', async () => {
    const { scheduler, launch } = await setup();
    let release: (v: { taskId: string }) => void = () => undefined;
    launch.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = scheduler.runNow('a1');
    const second = await scheduler.runNow('a1');
    expect(second.status).toBe('failed');
    expect(launch).toHaveBeenCalledTimes(1);
    release({ taskId: 't' });
    expect((await first).status).toBe('launched');
  });

  it('stops firing after stop', async () => {
    const { scheduler, launch, advance, clock } = await setup();
    scheduler.stop();
    expect(clock.pending()).toBe(0);
    await advance(30 * MINUTE);
    expect(launch).not.toHaveBeenCalled();
    expect(scheduler.nextRunAt('a1')).toBeNull();
  });

  it('never logs the prompt', async () => {
    const { advance, log } = await setup();
    await advance(10 * MINUTE);
    expect(log.text()).not.toContain('Gere o relatório');
  });
});

it('records every missed occurrence after suspension and preserves them after the next launch', async () => {
  const { scheduler, clock, store, launch, advance } = await setup();
  const now = vi.spyOn(clock, 'now').mockReturnValue(new Date(START + 35 * MINUTE));
  clock.advance(AUTOMATION_TICK_MS);
  for (let i = 0; i < 100; i++) await Promise.resolve();
  expect(launch).not.toHaveBeenCalled();
  expect(store.get('a1')?.runs?.map((run) => run.detail)).toEqual(
    [10, 20, 30].map((minutes) => new Date(START + minutes * MINUTE).toISOString()),
  );
  expect(scheduler.nextRunAt('a1')).toBe(new Date(START + 45 * MINUTE).toISOString());
  now.mockRestore();
  await advance(45 * MINUTE);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(store.get('a1')?.runs?.filter((run) => run.status === 'missed')).toHaveLength(3);
});
