import { MelinnaError } from '../errors';
import {
  AUTOMATION_INTERVAL_MAX,
  AUTOMATION_INTERVAL_MIN,
  type AutomationSchedule,
} from './types';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTE_MS = 60_000;

function invalid(message: string): MelinnaError {
  return new MelinnaError('INPUT_INVALID', { userMessage: message });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valida e normaliza um agendamento vindo de fora (interface ou arquivo): dias únicos e em ordem. */
export function parseSchedule(v: unknown): AutomationSchedule {
  if (!isObj(v)) throw invalid('Agendamento inválido.');
  if (v.kind === 'daily') {
    if (typeof v.time !== 'string' || !TIME.test(v.time)) throw invalid('Horário inválido: use HH:MM.');
    const days = v.days;
    if (!Array.isArray(days) || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw invalid('Dias da semana inválidos.');
    }
    return { kind: 'daily', time: v.time, days: [...new Set(days as number[])].sort((a, b) => a - b) };
  }
  if (v.kind === 'interval') {
    const minutes = v.minutes;
    if (
      typeof minutes !== 'number' ||
      !Number.isInteger(minutes) ||
      minutes < AUTOMATION_INTERVAL_MIN ||
      minutes > AUTOMATION_INTERVAL_MAX
    ) {
      throw invalid(`O intervalo deve ficar entre ${AUTOMATION_INTERVAL_MIN} minutos e 7 dias.`);
    }
    return { kind: 'interval', minutes };
  }
  throw invalid('Agendamento inválido.');
}

/**
 * Próximo disparo estritamente depois de `after`, no horário local. No intervalo, `after` é o último
 * disparo (ou a criação). Na troca de horário de verão, um horário que não existe cai no minuto seguinte
 * válido do mesmo dia, como o `Date` local resolve.
 */
export function nextRun(schedule: AutomationSchedule, after: Date): Date {
  if (schedule.kind === 'interval') return new Date(after.getTime() + schedule.minutes * MINUTE_MS);
  const [hours, minutes] = schedule.time.split(':').map(Number) as [number, number];
  const allowed = schedule.days.length === 0 ? null : new Set(schedule.days);
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset, hours, minutes, 0, 0);
    if (candidate.getTime() <= after.getTime()) continue;
    if (allowed && !allowed.has(candidate.getDay())) continue;
    return candidate;
  }
  // Inalcançável: em oito dias seguidos há sempre um dia permitido depois de `after`.
  throw new MelinnaError('INTERNAL');
}
