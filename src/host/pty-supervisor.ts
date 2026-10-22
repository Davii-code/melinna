import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  COLS_MAX,
  COLS_MIN,
  ROWS_MAX,
  ROWS_MIN,
  type AttachResult,
  type HostProcessInfo,
  type MarkerKind,
  type SpawnRequest,
} from '../core/contracts/host-protocol';
import { MelinnaError } from '../core/errors';
import type { AppPaths } from '../core/paths';
import type { Cancel, Clock } from '../core/ports/clock';
import type { FileSystem } from '../core/ports/file-system';
import type { Logger } from '../core/ports/logger';
import { ScrollbackWriter } from '../core/scrollback/scrollback-writer';
import { SegmentStore } from '../core/scrollback/segment-store';
import { FlowControl } from './flow-control';
import { killTree, reapGroup } from './kill-tree';
import type { PtyFactory, PtyProcess } from './node-pty-adapter';
import { TerminalQueryResponder, hostShouldRespond } from './query-responder';
import type { HostRegistry } from './registry';

export const ACTIVITY_INTERVAL_MS = 250;
const MAX_OUTPUT_CHUNK = 512 * 1024;
/** Intervalo até o segundo Ctrl+C ao parar: curto o bastante para o agente tratá-lo como confirmação. */
export const SECOND_CTRL_C_MS = 400;
const encoder = new TextEncoder();

export interface Subscriber {
  output(execId: string, offset: number, bytes: Uint8Array): void;
  marker(execId: string, kind: MarkerKind, lostBytes?: number): void;
}

export interface SupervisorEvents {
  exit(e: { execId: string; exitCode: number | null; signal: string | null; endedAt: string }): void;
  activity(e: { execId: string; lastOutputAt: string }): void;
  scrollbackStatus(e: { execId: string; persisting: boolean; reason?: 'DISK_FULL' | 'IO_ERROR' }): void;
  changed(): void;
}

interface SubState {
  replaying: boolean;
  queue: { offset: number; bytes: Uint8Array }[];
}

interface Proc {
  execId: string;
  pty: PtyProcess | null;
  pid: number;
  alive: boolean;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  rows: number;
  nextOffset: number;
  store: SegmentStore;
  writer: ScrollbackWriter;
  responder: TerminalQueryResponder;
  flow: FlowControl<Subscriber>;
  subs: Map<Subscriber, SubState>;
  lastActivityAt: number;
  activityTimer: Cancel | undefined;
  exitWaiters: (() => void)[];
}

export interface SupervisorDeps {
  ptyFactory: PtyFactory;
  fs: FileSystem;
  paths: AppPaths;
  clock: Clock;
  log: Logger;
  events: SupervisorEvents;
  registry?: HostRegistry;
}

function isExecutableFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Dono dos PTYs do hospedeiro: lança, escreve, redimensiona, grava o histórico e distribui a saída. */
export class PtySupervisor {
  private readonly procs = new Map<string, Proc>();

  constructor(private readonly deps: SupervisorDeps) {}

  aliveCount(): number {
    let n = 0;
    for (const p of this.procs.values()) if (p.alive) n++;
    return n;
  }

  list(): HostProcessInfo[] {
    return [...this.procs.values()]
      .filter((p) => p.pid > 0)
      .map((p) => ({
        execId: p.execId,
        pid: p.pid,
        alive: p.alive,
        exitCode: p.exitCode,
        signal: p.signal,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
        totalBytes: p.nextOffset,
      }));
  }

  async spawn(req: SpawnRequest): Promise<{ pid: number }> {
    if (!isAbsolute(req.file)) {
      throw new MelinnaError('UNSAFE_LAUNCHER', {
        userMessage: 'O hospedeiro só lança executáveis com caminho absoluto.',
      });
    }
    if (/\.(cmd|bat)$/i.test(req.file)) {
      throw new MelinnaError('UNSAFE_LAUNCHER', {
        userMessage: 'O hospedeiro não lança arquivos .cmd ou .bat.',
      });
    }
    if (!isExecutableFile(req.file)) {
      throw new MelinnaError('EXECUTABLE_NOT_FOUND', {
        userMessage: `Executável ${req.file} não encontrado.`,
      });
    }
    if (!existsSync(req.cwd)) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'A pasta de trabalho da execução não existe.' });
    }
    if (req.cols < COLS_MIN || req.cols > COLS_MAX || req.rows < ROWS_MIN || req.rows > ROWS_MAX) {
      throw new MelinnaError('INPUT_INVALID', { userMessage: 'Tamanho de terminal fora dos limites.' });
    }
    const existing = this.procs.get(req.execId);
    if (existing?.alive) {
      throw new MelinnaError('EXECUTION_RUNNING', { userMessage: 'A execução já está viva.' });
    }
    const proc = existing ?? (await this.dormant(req.execId));
    proc.rows = req.rows;
    if (req.separator) this.emitOutput(proc, encoder.encode(req.separator));

    let pty: PtyProcess;
    try {
      pty = this.deps.ptyFactory.spawn(req.file, req.args, {
        cwd: req.cwd,
        env: req.env,
        cols: req.cols,
        rows: req.rows,
      });
    } catch (cause) {
      this.deps.log.error('pty.spawn_failed', { execId: req.execId, err: cause });
      throw new MelinnaError('EXECUTABLE_NOT_FOUND', {
        userMessage: 'Não foi possível iniciar o processo.',
        cause,
      });
    }
    proc.pty = pty;
    proc.pid = pty.pid;
    proc.alive = true;
    proc.startedAt = this.deps.clock.now().toISOString();
    proc.endedAt = null;
    proc.exitCode = null;
    proc.signal = null;
    pty.onData((bytes) => this.emitOutput(proc, bytes));
    pty.onExit((e) => this.onExit(proc, e.exitCode, e.signal));
    await this.deps.registry?.set(req.execId, {
      pid: pty.pid,
      startedAt: proc.startedAt,
      exitCode: null,
      signal: null,
      endedAt: null,
      totalBytes: proc.nextOffset,
    });
    this.deps.log.info('pty.spawned', { execId: req.execId, pid: pty.pid });
    this.deps.events.changed();
    return { pid: pty.pid };
  }

  write(execId: string, data: Uint8Array): void {
    const p = this.procs.get(execId);
    if (!p?.alive || !p.pty) throw new MelinnaError('EXECUTION_NOT_RUNNING');
    p.pty.write(data);
  }

  /** Tamanhos fora dos limites são ignorados. */
  resize(execId: string, cols: number, rows: number): void {
    const p = this.procs.get(execId);
    if (!p?.alive || !p.pty) return;
    if (cols < COLS_MIN || cols > COLS_MAX || rows < ROWS_MIN || rows > ROWS_MAX) return;
    p.rows = rows;
    try {
      p.pty.resize(cols, rows);
    } catch (err) {
      this.deps.log.warn('pty.resize_failed', { execId, code: (err as Error).message });
    }
  }

  /**
   * Reproduz o histórico a partir de `fromOffset` entre `replay-start` e `replay-end` e emenda a saída ao vivo
   * a partir do deslocamento seguinte, sem lacuna nem duplicação.
   */
  async attach(execId: string, fromOffset: number, sub: Subscriber): Promise<AttachResult> {
    const proc = this.procs.get(execId) ?? (await this.dormantIfKnown(execId));
    if (!proc)
      throw new MelinnaError('EXECUTION_NOT_RUNNING', {
        userMessage: 'Não há histórico nem processo para esta execução.',
      });
    const prev = proc.subs.get(sub);
    if (prev) this.detach(execId, sub);
    const state: SubState = { replaying: true, queue: [] };
    proc.subs.set(sub, state);
    proc.flow.add(sub, fromOffset);
    sub.marker(execId, 'replay-start');
    const replay = await proc.writer.replayFrom(fromOffset);
    for (const item of replay.items) {
      if (item.kind === 'marker') {
        sub.marker(execId, item.marker, item.lostBytes);
        continue;
      }
      for (let i = 0; i < item.bytes.length; i += MAX_OUTPUT_CHUNK) {
        const piece = item.bytes.subarray(i, i + MAX_OUTPUT_CHUNK);
        sub.output(execId, item.offset + i, piece);
        proc.flow.sent(sub, item.offset + i + piece.length);
      }
    }
    sub.marker(execId, 'replay-end');
    let cursor = replay.endOffset;
    for (const chunk of state.queue) {
      const end = chunk.offset + chunk.bytes.length;
      if (end <= cursor) continue;
      const piece = chunk.bytes.subarray(Math.max(0, cursor - chunk.offset));
      sub.output(execId, Math.max(cursor, chunk.offset), piece);
      proc.flow.sent(sub, end);
      cursor = end;
    }
    state.queue = [];
    state.replaying = false;
    return { firstAvailableOffset: replay.firstAvailableOffset, totalBytes: proc.nextOffset };
  }

  detach(execId: string, sub: Subscriber): void {
    const p = this.procs.get(execId);
    if (!p) return;
    p.subs.delete(sub);
    p.flow.remove(sub);
  }

  detachAll(sub: Subscriber): void {
    for (const execId of this.procs.keys()) this.detach(execId, sub);
  }

  ack(execId: string, sub: Subscriber, offset: number): void {
    this.procs.get(execId)?.flow.ack(sub, offset);
  }

  /** Ctrl+C, espera `graceMs` e, se preciso, encerra a árvore à força. Só age sobre processos deste hospedeiro. */
  async kill(execId: string, graceMs: number): Promise<void> {
    const p = this.procs.get(execId);
    if (!p?.alive || !p.pty) throw new MelinnaError('EXECUTION_NOT_RUNNING');
    const exited = this.waitExit(p);
    const ctrlC = () => {
      try {
        p.pty?.write(new Uint8Array([0x03]));
      } catch {
        // PTY já fechado
      }
    };
    ctrlC();
    // Agentes como o Claude Code só saem com um segundo Ctrl+C logo depois do primeiro.
    const second = Math.min(SECOND_CTRL_C_MS, graceMs);
    const early = await Promise.race([exited.then(() => true), sleep(second).then(() => false)]);
    if (!early && p.alive) ctrlC();
    const graceful =
      early || (await Promise.race([exited.then(() => true), sleep(graceMs - second).then(() => false)]));
    if (!graceful && p.alive) {
      this.deps.log.info('pty.force_kill', { execId });
      await killTree(p.pid, () => p.alive);
      await Promise.race([exited, sleep(3000)]);
      if (p.alive) {
        try {
          p.pty.kill('SIGKILL');
        } catch {
          // ignorado
        }
        await Promise.race([exited, sleep(2000)]);
      }
    } else {
      reapGroup(p.pid);
    }
  }

  async shutdown(graceMs: number): Promise<void> {
    const alive = [...this.procs.values()].filter((p) => p.alive);
    await Promise.all(alive.map((p) => this.kill(p.execId, graceMs).catch(() => undefined)));
    await Promise.all([...this.procs.values()].map((p) => p.writer.close().catch(() => undefined)));
  }

  private waitExit(p: Proc): Promise<void> {
    if (!p.alive) return Promise.resolve();
    return new Promise((resolve) => p.exitWaiters.push(resolve));
  }

  private async dormantIfKnown(execId: string): Promise<Proc | null> {
    const dir = this.deps.paths.scrollbackDir(execId);
    if (!(await this.deps.fs.exists(join(dir, 'meta.json')))) return null;
    return this.dormant(execId);
  }

  /** Entrada sem processo: carrega o histórico em disco e continua a numeração a partir de `totalBytes`. */
  private async dormant(execId: string): Promise<Proc> {
    const store = new SegmentStore(this.deps.fs, this.deps.paths.scrollbackDir(execId), join);
    await store.open();
    const holder: { proc?: Proc } = {};
    const writer = new ScrollbackWriter(store, this.deps.clock, this.deps.log, (s) =>
      this.deps.events.scrollbackStatus(
        s.persisting ? { execId, persisting: true } : { execId, persisting: false, reason: s.reason },
      ),
    );
    const flow = new FlowControl<Subscriber>({
      pause: () => {
        if (holder.proc?.alive) holder.proc.pty?.pause();
      },
      resume: () => {
        if (holder.proc?.alive) holder.proc.pty?.resume();
      },
    });
    const proc: Proc = {
      execId,
      pty: null,
      pid: 0,
      alive: false,
      startedAt: '',
      endedAt: null,
      exitCode: null,
      signal: null,
      rows: 24,
      nextOffset: store.totalBytes,
      store,
      writer,
      responder: new TerminalQueryResponder(() => holder.proc?.rows ?? 24),
      flow,
      subs: new Map(),
      lastActivityAt: 0,
      activityTimer: undefined,
      exitWaiters: [],
    };
    holder.proc = proc;
    this.procs.set(execId, proc);
    return proc;
  }

  private emitOutput(proc: Proc, bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    const offset = proc.nextOffset;
    proc.nextOffset += bytes.length;
    proc.writer.push(offset, bytes);
    let live = 0;
    let replaying = 0;
    for (const [sub, st] of proc.subs) {
      if (st.replaying) {
        replaying++;
        st.queue.push({ offset, bytes });
        continue;
      }
      live++;
      sub.output(proc.execId, offset, bytes);
      proc.flow.sent(sub, offset + bytes.length);
    }
    const replies = proc.responder.observe(bytes);
    if (replies.length > 0 && proc.alive && proc.pty && hostShouldRespond(live, replaying)) {
      for (const r of replies) proc.pty.write(encoder.encode(r));
    }
    if (proc.alive) this.activity(proc);
  }

  private activity(proc: Proc): void {
    const now = this.deps.clock.now().getTime();
    const emit = () => {
      proc.activityTimer = undefined;
      proc.lastActivityAt = this.deps.clock.now().getTime();
      this.deps.events.activity({
        execId: proc.execId,
        lastOutputAt: new Date(proc.lastActivityAt).toISOString(),
      });
    };
    if (now - proc.lastActivityAt >= ACTIVITY_INTERVAL_MS) {
      emit();
      return;
    }
    proc.activityTimer ??= this.deps.clock.setTimeout(
      emit,
      ACTIVITY_INTERVAL_MS - (now - proc.lastActivityAt),
    );
  }

  private onExit(proc: Proc, exitCode: number | null, signal: string | null): void {
    proc.alive = false;
    proc.exitCode = exitCode;
    proc.signal = signal;
    proc.endedAt = this.deps.clock.now().toISOString();
    proc.activityTimer?.();
    proc.activityTimer = undefined;
    for (const w of proc.exitWaiters.splice(0)) w();
    this.deps.log.info('pty.exited', { execId: proc.execId, code: exitCode, signal });
    void proc.writer.flush().then(() =>
      this.deps.registry?.update(proc.execId, {
        exitCode,
        signal,
        endedAt: proc.endedAt,
        totalBytes: proc.nextOffset,
      }),
    );
    this.deps.events.exit({ execId: proc.execId, exitCode, signal, endedAt: proc.endedAt });
    this.deps.events.changed();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
