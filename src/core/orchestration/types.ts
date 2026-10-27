export type Provider = 'claude' | 'codex';
export type Access = 'read-only' | 'workspace-write';
export type JobStatus =
  'queued' | 'starting' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type RunStatus =
  'running' | 'paused' | 'waiting_user' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';

export interface AgentRole {
  id: string;
  name: string;
  provider: Provider;
  model: string;
  instructions: string;
  access: Access;
}
export interface TeamTemplate {
  id: string;
  name: string;
  coordinator: AgentRole;
  workers: AgentRole[];
  limits: {
    parallel: number;
    jobs: number;
    timeoutMinutes: number;
    maxTurns: number;
    /** Soft cap: providers may report usage only after completion. */
    maxTokens: number;
  };
}
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd?: number;
}
export interface AgentEvent {
  seq: number;
  at: string;
  type: 'status' | 'text' | 'tool' | 'error' | 'usage';
  text: string;
}
export interface DelegatedJob {
  id: string;
  roleId: string;
  requestKey: string;
  prompt: string;
  status: JobStatus;
  cwd: string;
  branch?: string;
  baseCommit?: string;
  providerSessionId?: string;
  createdAt: string;
  endedAt?: string;
  result?: string;
  error?: string;
  usage?: Usage;
  events: AgentEvent[];
  patchAvailable?: boolean;
  patchApplied?: boolean;
}
export interface OrchestrationRun {
  id: string;
  team: TeamTemplate;
  groupId: string;
  cwd: string;
  objective: string;
  baseCommit?: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  coordinatorSessionId?: string;
  integrationFingerprint?: string;
  coordinatorTurn: number;
  coordinatorEvents: AgentEvent[];
  jobs: DelegatedJob[];
  messages: { role: 'user' | 'assistant'; text: string; at: string }[];
  usage: Usage;
  error?: string;
}
export interface OrchestrationSnapshot {
  schemaVersion: 1;
  warning?: string;
  templates: TeamTemplate[];
  runs: OrchestrationRun[];
}
export interface PreflightResult {
  provider: Provider;
  available: boolean;
  version?: string;
  error?: string;
}
export const ACTIVE_JOBS: readonly JobStatus[] = ['queued', 'starting', 'running'];
export const DEFAULT_TEAM: TeamTemplate = {
  id: '',
  name: 'Minha equipe',
  coordinator: {
    id: 'coordinator',
    name: 'Coordenador',
    provider: 'claude',
    model: 'opus',
    instructions:
      'Decomponha o objetivo, delegue trabalhos independentes e revise as evidências antes de responder.',
    access: 'read-only',
  },
  workers: [
    {
      id: 'researcher',
      name: 'Pesquisa',
      provider: 'claude',
      model: 'haiku',
      instructions: 'Investigue o código e devolva conclusões objetivas com caminhos relevantes.',
      access: 'read-only',
    },
    {
      id: 'developer',
      name: 'Implementação',
      provider: 'codex',
      model: '',
      instructions:
        'Implemente o escopo recebido. Não faça commits ou pushes. Relate arquivos alterados e verificações realmente executadas.',
      access: 'workspace-write',
    },
  ],
  limits: { parallel: 2, jobs: 8, timeoutMinutes: 15, maxTurns: 8, maxTokens: 200000 },
};
