import type { WorkspaceSnapshot } from '../api-types';
import type { StateStore } from '../persistence/state-store';
import type { Execution, Group, StateFile, Task } from '../persistence/state-schema';
import type { Unsubscribe } from '../ports/host-client';
import { MAX_LIVE_EXECUTIONS } from '../execution/limits';
import { isLive } from '../execution/state-machine';

export type { WorkspaceSnapshot };

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
  private readonly paused = new Map<string, 'DISK_FULL' | 'IO_ERROR'>();

  private busyIds: () => readonly string[] = () => [];

  constructor(
    private readonly state: StateFile,
    private readonly store: StateStore,
    private readonly readOnly = false,
  ) {}

  /** Fonte das execuções ocupadas, ligada pelo serviço de execuções. */
  setBusySource(fn: () => readonly string[]): void {
    this.busyIds = fn;
  }

  /** Notifica uma mudança que não altera o estado persistido (ocupação, gravação). */
  touch(): void {
    this.version++;
    this.cached = undefined;
    this.notify();
  }

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

  setScrollbackPaused(execId: string, reason: 'DISK_FULL' | 'IO_ERROR' | null): void {
    if ((this.paused.get(execId) ?? null) === reason) return;
    if (reason) this.paused.set(execId, reason);
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
      scrollbackPaused: [...this.paused].map(([execId, reason]) => ({ execId, reason })),
      busy: [...this.busyIds()],
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
