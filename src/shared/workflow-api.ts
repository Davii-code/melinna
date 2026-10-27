import type { AgentPick, LaunchResult, Result, RunChoice, RunNeedsConfirm, TermSize } from './ipc-contract';
import type {
  Checkpoint,
  RestorePreview,
  TaskNotes,
  TaskReview,
  UsageProfile,
  WorkflowData,
  WorkflowSnapshot,
  ReviewDiff,
  Verification,
} from '../core/workflow/types';
export type {
  Checkpoint,
  RestorePreview,
  TaskNotes,
  TaskReview,
  UsageProfile,
  WorkflowData,
  WorkflowSnapshot,
  ReviewChange,
  ReviewDiff,
  Verification,
} from '../core/workflow/types';
export interface WorkflowApi {
  snapshot(): Promise<Result<WorkflowSnapshot>>;
  saveProfile(value: UsageProfile): Promise<Result<UsageProfile>>;
  removeProfile(id: string): Promise<Result<void>>;
  preferences(value: WorkflowData['preferences']): Promise<Result<void>>;
  review(executionId: string, checkpointId?: string): Promise<Result<TaskReview>>;
  saveNotes(taskId: string, value: TaskNotes): Promise<Result<void>>;
  checkpoint(executionId: string, name: string): Promise<Result<Checkpoint>>;
  diff(executionId: string, checkpointId: string, root: string, path: string): Promise<Result<ReviewDiff>>;
  previewRestore(checkpointId: string): Promise<Result<RestorePreview>>;
  restore(previewId: string): Promise<Result<Checkpoint>>;
  draftHandoff(executionId: string): Promise<Result<string>>;
  handoff(input: {
    executionId: string;
    briefing: string;
    pick: AgentPick;
    size: TermSize;
  }): Promise<Result<LaunchResult[]>>;
  verify(
    executionId: string,
    configId: string,
    size: TermSize,
    choice?: RunChoice,
  ): Promise<Result<Verification | RunNeedsConfirm>>;
  cancelVerification(id: string): Promise<Result<void>>;
  markRead(): Promise<Result<void>>;
  onChange(fn: () => void): () => void;
}

export { emptyWorkflow } from '../core/workflow/types';
