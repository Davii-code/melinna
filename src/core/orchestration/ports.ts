import type { AgentRole, OrchestrationSnapshot, Provider, Usage } from './types';

export interface TurnOutput {
  text: string;
  sessionId?: string;
  usage?: Usage;
}
export interface TurnRequest {
  role: AgentRole;
  cwd: string;
  prompt: string;
  sessionId?: string;
  bridge?: { url: string; token: string };
  signal: AbortSignal;
  timeoutMs: number;
  onEvent: (type: 'text' | 'tool' | 'error', text: string) => void;
  onSession?: (id: string) => void;
}
export interface OrchestrationRuntime {
  preflight(provider: Provider): Promise<{ version: string }>;
  turn(request: TurnRequest): Promise<TurnOutput>;
  baseline(cwd: string): Promise<string | undefined>;
  prepare(
    runId: string,
    jobId: string,
    cwd: string,
    access: AgentRole['access'],
    baseCommit?: string,
  ): Promise<{ cwd: string; baseCommit?: string; branch?: string }>;
  patch(jobCwd: string, baseCommit: string): Promise<string>;
  apply(cwd: string, patch: string, expectedFingerprint?: string): Promise<string>;
}
export interface OrchestrationStore {
  load(): Promise<OrchestrationSnapshot>;
  save(snapshot: OrchestrationSnapshot): Promise<void>;
}
export interface DelegationBridge {
  open(runId: string): Promise<{ url: string; token: string }>;
  revoke(runId: string): void;
  close(): Promise<void>;
}
