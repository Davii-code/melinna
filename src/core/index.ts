// API pública do núcleo (contracts/core-api.md): serviços, portas e tipos consumidos pelo principal e, depois, por daemon e CLI.
export type * from './api-types';
export {
  CatalogService,
  type CatalogServiceDeps,
  type LaunchInput,
  type LaunchPlan,
} from './catalog/catalog-service';
export type { AgentDefinition, CatalogIssue, CatalogLoadResult, SwitchStrategy } from './catalog/schema';
export { hostEndpointPath, parseEndpointFile, type EndpointFile } from './contracts/endpoint';
export { FrameDecoder, encodeFrame } from './contracts/frame-codec';
export * from './contracts/host-protocol';
export {
  ERROR_CODES,
  MelinnaError,
  isMelinnaError,
  toIpcError,
  type ErrorCode,
  type IpcError,
} from './errors';
export { ExecutionService } from './execution/execution-service';
export type { ExecutionDeps, HostProvider } from './execution/context';
export { MAX_LIVE_EXECUTIONS, freeSlots } from './execution/limits';
export { GitRunner } from './git/git-runner';
export { KeyedMutex } from './git/repo-mutex';
export { findOrphanLeases } from './git/residue';
export { newId } from './ids';
export { JsonlSink } from './log/jsonl-sink';
export { createLogger } from './log/logger';
export { makePaths, repoIdOf, type AppPaths } from './paths';
export * from './persistence/state-schema';
export { StateStore } from './persistence/state-store';
export type { Cancel, Clock } from './ports/clock';
export type { FileStat, FileSystem } from './ports/file-system';
export type * from './ports/host-client';
export type { LogFields, Logger } from './ports/logger';
export type { OsName, Platform } from './ports/platform';
export type { ProcessRunner, RunOptions, RunResult } from './ports/process-runner';
export { WorkspaceModel } from './workspace/workspace-model';
export { WorkspaceService, type CreateTaskInput } from './workspace/workspace-service';
