import type { AgentPick, LaunchResult, TermSize } from '../api-types';
import type { Execution, Task } from '../persistence/state-schema';
import type { RunChoice, RunNeedsConfirm, RunStarted } from '../run/types';
import type { FileDiff } from '../api-types';
import type { ReviewChange, SnapshotManifest, WorkflowData, WorkflowNotice } from './types';
export interface WorkflowStore {
  load(): Promise<WorkflowData>;
  save(data: WorkflowData): Promise<void>;
}
export interface CheckpointFiles {
  capture(roots: string[]): Promise<SnapshotManifest>;
  inspect(roots: string[]): Promise<SnapshotManifest>;
  compare(before: SnapshotManifest, after: SnapshotManifest): ReviewChange[];
  diff(change: ReviewChange): Promise<FileDiff>;
  restore(target: SnapshotManifest, expected: SnapshotManifest): Promise<void>;
  overlaps(a: string, b: string): boolean;
}
export interface WorkflowExecutionPort {
  execution(id: string): Execution | undefined;
  task(id: string): Task | undefined;
  executions(): Execution[];
  groupExists(id: string): boolean;
  validatePick(pick: AgentPick): Promise<void>;
  launch(
    taskId: string,
    pick: AgentPick,
    prompt: string,
    size: TermSize,
    source?: SnapshotManifest,
  ): Promise<LaunchResult[]>;
  stopAndWait(id: string): Promise<void>;
  verify(
    executionId: string,
    configId: string,
    size: TermSize,
    verificationId: string,
    choice?: RunChoice,
  ): Promise<RunStarted | RunNeedsConfirm>;
  cancelVerify(id: string): Promise<void>;
  verificationLabel(taskId: string, configId: string): string;
}
export interface WorkflowDependencies {
  store: WorkflowStore;
  files: CheckpointFiles;
  executions: WorkflowExecutionPort;
  id(): string;
  now(): string;
  changed(): void;
  notify(notice: WorkflowNotice, desktop: boolean): void;
}
