/** Quando a automação dispara, no horário local da máquina. */
export type AutomationSchedule =
  /** Todo dia marcado em `days` (0 = domingo … 6 = sábado; vazio = todos), às `time` (`HH:MM`). */
  | { kind: 'daily'; time: string; days: number[] }
  /** A cada `minutes` minutos, contados do último disparo. */
  | { kind: 'interval'; minutes: number };

export type AutomationRunStatus = 'launched' | 'failed' | 'missed';

/** Resultado do último disparo. `missed` = o horário passou com o app fechado; nada rodou. */
export interface AutomationRun {
  /** ISO 8601. */
  at: string;
  status: AutomationRunStatus;
  /** Motivo da falha, ou o horário perdido. */
  detail?: string;
  taskId?: string;
}

export interface Automation {
  id: string;
  name: string;
  /** Pasta onde a sessão abre (vira ou reaproveita um workspace). */
  folder: string;
  agentId: string;
  prompt: string;
  schedule: AutomationSchedule;
  enabled: boolean;
  /** `worktree` isola a sessão num git worktree; `direct` roda na própria pasta. */
  isolation: 'direct' | 'worktree';
  createdAt: string;
  lastRun: AutomationRun | null;
  /** Hist?rico persistente, incluindo cada hor?rio perdido. */
  runs?: AutomationRun[];
}

/** O que a interface envia para criar (sem `id`) ou editar uma automação. */
export interface AutomationInput {
  id?: string;
  name: string;
  folder: string;
  agentId: string;
  prompt: string;
  schedule: AutomationSchedule;
  enabled: boolean;
  isolation: 'direct' | 'worktree';
}

/** Conteúdo de `userData/automations.json`. */
export interface AutomationsFile {
  version: 1;
  automations: Automation[];
}

export const AUTOMATIONS_FILE_VERSION = 1;
export const AUTOMATION_NAME_MAX = 80;
export const AUTOMATION_PROMPT_MAX = 100_000;
export const AUTOMATION_FOLDER_MAX = 4096;
export const AUTOMATIONS_MAX = 100;
export const AUTOMATION_INTERVAL_MIN = 5;
export const AUTOMATION_INTERVAL_MAX = 7 * 24 * 60;
