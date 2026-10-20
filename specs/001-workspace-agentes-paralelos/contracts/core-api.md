# Contrato: API pública do núcleo (`src/core/index.ts`)

O núcleo exporta serviços (consumidos pelo principal, e depois por daemon e CLI) e portas (implementadas pelos adaptadores). Nada aqui referencia Electron, node-pty ou React.

## Portas

```ts
interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields & { err?: unknown }): void;
  child(component: string): Logger;
}

interface Clock { now(): Date; setTimeout(fn: () => void, ms: number): Cancel; }

interface FileSystem {            // subconjunto de fs/promises usado pelo núcleo
  readFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, data: Uint8Array | string, opts?: { flag?: 'w' | 'wx' | 'a' }): Promise<void>;
  appendFile(p: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(p: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>;
  mkdir(p: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(p: string): Promise<string[]>;
  stat(p: string): Promise<{ size: number; isFile: boolean; isDirectory: boolean }>;
  exists(p: string): Promise<boolean>;
  fsyncFile(p: string): Promise<void>;
}

interface ProcessRunner {          // execFile, sem shell
  run(file: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }):
    Promise<{ exitCode: number; stdout: Uint8Array; stderr: Uint8Array }>;
}

interface Platform { os: 'win32' | 'darwin' | 'linux'; pathEnv: string; pathExt: string[]; }

interface HostClient {             // implementado em src/main/host-client.ts
  spawn(req: SpawnRequest): Promise<{ pid: number }>;
  write(execId: string, data: Uint8Array): void;
  resize(execId: string, cols: number, rows: number): void;
  kill(execId: string, opts: { graceMs: number }): Promise<void>;
  attach(execId: string, fromOffset: number, sink: OutputSink): Promise<Detach>;
  ack(execId: string, offset: number): void;       // controle de fluxo, ver host-protocol
  list(): Promise<HostProcessInfo[]>;
  on(event: 'exit', fn: (e: ExitEvent) => void): Unsubscribe;
  on(event: 'activity', fn: (e: ActivityEvent) => void): Unsubscribe;
  on(event: 'scrollback-status', fn: (e: ScrollbackStatusEvent) => void): Unsubscribe;
  on(event: 'disconnected', fn: () => void): Unsubscribe;
}
```

## Serviços

```ts
interface CatalogService {
  load(): Promise<CatalogLoadResult>;               // { agents, invalid: [{ source, id?, reason }] }
  detect(agentId: string): Promise<DetectResult>;   // { installed, resolvedPath?, reason? }
  detectAll(): Promise<Record<string, DetectResult>>;
  buildLaunch(input: LaunchInput): Promise<LaunchPlan>; // { file, args, promptViaPty?: string }
}

interface WorkspaceService {
  snapshot(): WorkspaceSnapshot;
  subscribe(fn: (s: WorkspaceSnapshot) => void): Unsubscribe;
  createGroup(name: string): Promise<Group>;
  renameGroup(id: string, name: string): Promise<void>;
  inspectRepo(repoPath: string, baseRef: string): Promise<RepoInspection>; // { root, baseCommit, uncommittedCount }
  createTask(input: CreateTaskInput): Promise<Task>;
  renameTask(id: string, title: string): Promise<void>;
  // Remove um resíduo apontado por um erro WORKTREE_RESIDUE (details.residuePath).
  // Recusa caminhos fora de <userData>/worktrees e caminhos com lease válido.
  cleanResidue(residuePath: string): Promise<void>;
}

interface ExecutionService {
  launch(taskId: string, picks: AgentPick[], size: TermSize): Promise<LaunchResult[]>; // um resultado por pick
  write(execId: string, data: Uint8Array): void;
  resize(execId: string, size: TermSize): void;
  stop(execId: string): Promise<void>;
  relaunch(execId: string, size: TermSize): Promise<void>;
  removalCheck(execId: string): Promise<{ uncommittedFiles: number; unmergedCommits: number; branch: string }>;
  // force=false com uncommittedFiles>0 ou (deleteBranch e unmergedCommits>0) → WORK_WOULD_BE_LOST
  remove(execId: string, opts: { deleteBranch: boolean; force: boolean }): Promise<void>;
  attach(execId: string, sink: OutputSink): Promise<Detach>;
  requestSwitch(execId: string, kind: 'model' | 'permission', value: string): Promise<SwitchPlan>;
  confirmSwitch(execId: string, planId: string): Promise<void>;
  cancelPendingSwitch(execId: string): void;
  divergence(execId: string): Promise<{ baseAdvancedBy: number }>;
  reconcileWithHost(): Promise<void>;          // na abertura: marca exited/lost conforme o hospedeiro
  stopAll(graceMs: number): Promise<void>;
  liveCount(): number;
}

type SwitchPlan =
  | { planId: string; kind: 'pty-command'; waitsForIdle: boolean }
  | { planId: string; kind: 'restart-resume'; interruptsResponse: boolean }
  | { planId: string; kind: 'restart-fresh'; losesConversation: true; interruptsResponse: boolean };

interface DiffService {
  diff(execId: string): Promise<DiffResult>;    // { files: FileDiff[] }
}

interface FileDiff {
  path: string; oldPath?: string;
  change: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  binary?: { oldSize: number | null; newSize: number | null };
  hunks: Hunk[]; lineCount: number;             // lineCount > 5000 → recolhido na interface
}

// Funções puras de layout (src/core/layout)
function computeAuto(ids: string[], area: Px, min: TermCellPx): Rect[] | { overflowRows: Rect[] };
function computeSpotlight(ids: string[], focused: string, area: Px): Rect[];
function computeSidebar(ids: string[], focused: string, area: Px): Rect[];
function computeCustom(state: CustomGrid, area: Px): Rect[];
function moveDivider(state: CustomGrid, axis: 'col' | 'row', index: number, deltaFraction: number, minFraction: number): CustomGrid;
function reorder(ids: string[], from: number, to: number): string[];
```

## Erros

Todos os métodos assíncronos rejeitam apenas com `MelinnaError` (união fechada de códigos no plan, Tratamento de erro). `LaunchResult` é `{ execId, ok: true } | { execId?, agentId, ok: false, error }` para que falhas parciais não derrubem o lote.
