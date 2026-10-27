import type { Result } from './ipc-contract';
import type { TeamTemplate, OrchestrationSnapshot, PreflightResult } from '../core/orchestration/types';

export interface OrchestrationApi {
  snapshot(): Promise<Result<OrchestrationSnapshot>>;
  saveTeam(team: TeamTemplate): Promise<Result<TeamTemplate>>;
  removeTeam(id: string): Promise<Result<void>>;
  preflight(team: TeamTemplate): Promise<Result<PreflightResult[]>>;
  start(input: { teamId: string; groupId: string; prompt: string }): Promise<Result<string>>;
  message(runId: string, text: string): Promise<Result<void>>;
  control(runId: string, action: 'pause' | 'resume' | 'cancel'): Promise<Result<void>>;
  cancelJob(runId: string, jobId: string): Promise<Result<void>>;
  retryJob(runId: string, jobId: string): Promise<Result<void>>;
  patch(runId: string, jobId: string): Promise<Result<string>>;
  applyPatch(runId: string, jobId: string): Promise<Result<void>>;
  onChange(fn: () => void): () => void;
}

export type {
  AgentRole,
  TeamTemplate,
  OrchestrationRun,
  DelegatedJob,
  OrchestrationSnapshot,
  AgentEvent,
  JobStatus,
  RunStatus,
  Provider,
  PreflightResult,
} from '../core/orchestration/types';
export { DEFAULT_TEAM, ACTIVE_JOBS } from '../core/orchestration/types';
