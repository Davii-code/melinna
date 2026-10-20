import type { StateStore } from '../persistence/state-store';
import type { Execution, Group, LayoutState, StateFile, Task } from '../persistence/state-schema';
import type { Unsubscribe } from '../ports/host-client';
import { MAX_LIVE_EXECUTIONS } from '../execution/limits';
import { isLive } from '../execution/state-machine';

export interface WorkspaceSnapshot {
  version: number;
  groups: readonly Group[];
  tasks: readonly Task[];
  executions: readonly Execution[];
  layout: LayoutState;
  liveCount: number;
  maxLive: number;
  readOnly: boolean;
  /** Execuções cuja gravação de histórico está suspensa (disco cheio ou erro de E/S). */
  scrollbackPaused: readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/** Estado do workspace em memória: mutações persistem por `StateStore` e notificam assinantes com snapshots imutáveis. */
export class WorkspaceModel {
  private version = 0;
  private cached: WorkspaceSnapshot | undefined;
  private readonly listeners = new Set<(s: WorkspaceSnapshot) => void>();
  private readonly paused = new Set<string>();

  constructor(
    private readonly state: StateFile,
    private readonly store: StateStore,
    private readonly readOnly = false,
  ) {}

  get raw(): Readonly<StateFile> {
    return this.state;
  }

  group(id: string): Group | undefined {
    return this.state.groups.find((g) => g.id === id);
  }

  task(id: string): Task | undefined {
    return this.state.tasks.find((t) => t.id === id);
  }

  execution(id: string): Execution | undefined {
    return this.state.executions.find((e) => e.id === id);
  }

  executionsOf(taskId: string): Execution[] {
    return this.state.executions.filter((e) => e.taskId === taskId);
  }

  liveCount(): number {
    return this.state.executions.filter((e) => isLive(e.status)).length;
  }

  /** Aplica uma mudança, persiste (com debounce) e notifica. */
  mutate(fn: (s: StateFile) => void): void {
    fn(this.state);
    this.version++;
    this.cached = undefined;
    this.store.save(structuredClone(this.state));
    this.notify();
  }

  setScrollbackPaused(execId: string, paused: boolean): void {
    const had = this.paused.has(execId);
    if (paused === had) return;
    if (paused) this.paused.add(execId);
    else this.paused.delete(execId);
    this.version++;
    this.cached = undefined;
    this.notify();
  }

  snapshot(): WorkspaceSnapshot {
    this.cached ??= deepFreeze({
      version: this.version,
      groups: structuredClone(this.state.groups),
      tasks: structuredClone(this.state.tasks),
      executions: structuredClone(this.state.executions),
      layout: structuredClone(this.state.layout),
      liveCount: this.liveCount(),
      maxLive: MAX_LIVE_EXECUTIONS,
      readOnly: this.readOnly,
      scrollbackPaused: [...this.paused],
    });
    return this.cached;
  }

  subscribe(fn: (s: WorkspaceSnapshot) => void): Unsubscribe {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  flush(): Promise<void> {
    return this.store.flush();
  }

  private notify(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }
}
