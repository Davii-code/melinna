import { describe, expect, it } from 'vitest';
import { nextRun, parseSchedule } from '../../../../src/core/automations/schedule';
import type { MelinnaError } from '../../../../src/core/errors';

/** Segunda-feira, 2 de março de 2026, no horário local. */
const monday = (h: number, m = 0) => new Date(2026, 2, 2, h, m, 0, 0);

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return (err as MelinnaError).userMessage;
  }
  throw new Error('deveria ter falhado');
}

describe('parseSchedule', () => {
  it('accepts a daily time and sorts and dedupes the days', () => {
    expect(parseSchedule({ kind: 'daily', time: '09:30', days: [5, 1, 5] })).toEqual({
      kind: 'daily',
      time: '09:30',
      days: [1, 5],
    });
    expect(parseSchedule({ kind: 'daily', time: '00:00', days: [] }).days).toEqual([]);
  });

  it('refuses malformed times and days', () => {
    for (const time of ['9:30', '24:00', '12:60', '', 930]) {
      expect(message(() => parseSchedule({ kind: 'daily', time, days: [] }))).toMatch(/HH:MM/);
    }
    for (const days of [[7], [-1], [1.5], 'seg', undefined]) {
      expect(message(() => parseSchedule({ kind: 'daily', time: '09:00', days }))).toMatch(/Dias/);
    }
  });

  it('accepts an interval between 5 minutes and 7 days', () => {
    expect(parseSchedule({ kind: 'interval', minutes: 5 })).toEqual({ kind: 'interval', minutes: 5 });
    expect(parseSchedule({ kind: 'interval', minutes: 10_080 }).kind).toBe('interval');
    for (const minutes of [4, 10_081, 7.5, '60']) {
      expect(message(() => parseSchedule({ kind: 'interval', minutes }))).toMatch(/intervalo/);
    }
  });

  it('refuses unknown shapes', () => {
    for (const bad of [null, 'daily', [], { kind: 'cron', expr: '* * * * *' }]) {
      expect(message(() => parseSchedule(bad))).toBe('Agendamento inválido.');
    }
  });
});

describe('nextRun', () => {
  it('runs later the same day when the time has not passed', () => {
    expect(nextRun({ kind: 'daily', time: '09:30', days: [] }, monday(8))).toEqual(monday(9, 30));
  });

  it('goes to the next day when the time has passed or is exactly now', () => {
    const tuesday = new Date(2026, 2, 3, 9, 30, 0, 0);
    expect(nextRun({ kind: 'daily', time: '09:30', days: [] }, monday(10))).toEqual(tuesday);
    expect(nextRun({ kind: 'daily', time: '09:30', days: [] }, monday(9, 30))).toEqual(tuesday);
  });

  it('skips the days that are not marked', () => {
    const friday = new Date(2026, 2, 6, 18, 0, 0, 0);
    expect(nextRun({ kind: 'daily', time: '18:00', days: [5] }, monday(8))).toEqual(friday);
    const nextMonday = new Date(2026, 2, 9, 7, 0, 0, 0);
    expect(nextRun({ kind: 'daily', time: '07:00', days: [1] }, monday(8))).toEqual(nextMonday);
  });

  it('crosses the end of the month', () => {
    const lastDay = new Date(2026, 2, 31, 23, 0, 0, 0);
    expect(nextRun({ kind: 'daily', time: '06:00', days: [] }, lastDay)).toEqual(new Date(2026, 3, 1, 6, 0, 0, 0));
  });

  it('adds the interval to the last run', () => {
    expect(nextRun({ kind: 'interval', minutes: 45 }, monday(8))).toEqual(monday(8, 45));
  });
});
