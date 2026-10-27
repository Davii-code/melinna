import type { Execution, Task } from '../persistence/state-schema';
import type { FileDiff } from '../api-types';

export interface UsageProfile {
  id: string;
  name: string;
  groupId: string | null;
  agentId: string;
  model: string | null;
  permission: string | null;
  instructions: string;
  checkpointBeforeLaunch: boolean;
}
export interface TaskNotes {
  objective: string;
  decisions: string;
  pending: string;
  constraints: string;
}
export interface WorkflowTask {
  taskId: string;
  profileId: string | null;
  checkpointBeforeLaunch: boolean;
  notes: TaskNotes;
}
export interface SnapshotFile {
  path: string;
  hash: string;
  bytes: number;
  mode: number;
}
export interface SnapshotFolder {
  root: string;
  files: SnapshotFile[];
}
export interface SnapshotManifest {
  folders: SnapshotFolder[];
  fingerprint: string;
  scope: string;
}
export interface Checkpoint {
  id: string;
  taskId: string;
  executionId: string;
  name: string;
  reason: 'before-launch' | 'manual' | 'before-restore' | 'handoff';
  createdAt: string;
  manifest: SnapshotManifest;
}
export interface ReviewChange {
  root: string;
  path: string;
  change: 'added' | 'modified' | 'deleted';
  beforeHash: string | null;
  afterHash: string | null;
  beforeBytes: number;
  afterBytes: number;
}
export interface Verification {
  id: string;
  taskId: string;
  executionId: string;
  commandExecutionId: string | null;
  configId: string;
  label: string;
  status: 'starting' | 'running' | 'passed' | 'failed' | 'cancelled' | 'interrupted';
  fingerprint: string;
  createdAt: string;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
}
export interface Handoff {
  id: string;
  taskId: string;
  sourceExecutionId: string;
  targetExecutionId: string | null;
  briefing: string;
  createdAt: string;
}
export interface WorkflowNotice {
  id: string;
  executionId: string;
  taskId: string;
  kind: 'ended' | 'error' | 'verification' | 'quiet';
  text: string;
  at: string;
  read: boolean;
}
export interface WorkflowData {
  version: 1;
  profiles: UsageProfile[];
  tasks: WorkflowTask[];
  checkpoints: Checkpoint[];
  verifications: Verification[];
  handoffs: Handoff[];
  notices: WorkflowNotice[];
  preferences: {
    checkpointBeforeLaunch: boolean;
    desktopNotifications: boolean;
    quietNotifications: boolean;
  };
}
export interface WorkflowSnapshot extends WorkflowData {
  warning?: string;
}
export interface TaskReview {
  task: Task;
  execution: Execution;
  notes: TaskNotes;
  checkpoint: Checkpoint | null;
  checkpoints: Checkpoint[];
  changes: ReviewChange[];
  fingerprint: string;
  verifications: (Verification & { stale: boolean })[];
  handoffs: Handoff[];
  scope: string;
  partial?: boolean;
  otherLiveExecutions: string[];
}
export interface RestorePreview {
  id: string;
  checkpointId: string;
  changes: ReviewChange[];
  expiresAt: string;
}
export type ReviewDiff = FileDiff;
export function emptyWorkflow(): WorkflowData {
  return {
    version: 1,
    profiles: [],
    tasks: [],
    checkpoints: [],
    verifications: [],
    handoffs: [],
    notices: [],
    preferences: { checkpointBeforeLaunch: true, desktopNotifications: false, quietNotifications: false },
  };
}
