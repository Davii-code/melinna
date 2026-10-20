import { MelinnaError } from '../../core/errors';
import type { ExecutionService } from '../../core/execution/execution-service';
import { isEnded } from '../../core/execution/state-machine';
import { newId } from '../../core/ids';
import type { Detach } from '../../core/ports/host-client';
import type { Logger } from '../../core/ports/logger';
import type { WorkspaceModel } from '../../core/workspace/workspace-model';
import { CHANNELS, EVENTS, LIMITS, type TerminalToPage } from '../../shared/ipc-contract';
import { handler, type Handle } from './result';
import { id, isObj } from './validate-common';

export interface MainPort {
  postMessage(message: unknown): void;
  on(event: 'message', fn: (e: { data: unknown }) => void): void;
  start(): void;
  close(): void;
}

export interface PortPair {
  port1: MainPort;
  port2: unknown;
}

export interface PortTarget {
  postMessage(channel: string, message: unknown, transfer: unknown[]): void;
}

export interface TerminalBridgeDeps {
  executions: ExecutionService;
  model: WorkspaceModel;
  log: Logger;
  createChannel: () => PortPair;
  /** Janela que recebe o port. */
  target: () => PortTarget | null;
}

interface Open {
  channelId: string;
  port: MainPort;
  detach: Detach | null;
  closed: boolean;
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

/** Um canal (MessagePort) por painel entre o principal e a página, ligado à saída da execução no hospedeiro. */
export class TerminalBridge {
  private readonly open = new Map<string, Open>();

  constructor(private readonly deps: TerminalBridgeDeps) {
    deps.executions.onExit((e) =>
      this.send(e.execId, { type: 'exit', exitCode: e.exitCode, signal: e.signal }),
    );
  }

  isOpen(execId: string): boolean {
    return this.open.has(execId);
  }

  async openTerminal(execId: string): Promise<{ channelId: string }> {
    const exec = this.deps.model.execution(execId);
    if (!exec) throw new MelinnaError('INPUT_INVALID', { userMessage: 'Execução não encontrada.' });
    const target = this.deps.target();
    if (!target) throw new MelinnaError('INTERNAL', { userMessage: 'Janela indisponível.' });
    await this.closeTerminal(execId);
    const { port1, port2 } = this.deps.createChannel();
    const channelId = newId();
    const entry: Open = { channelId, port: port1, detach: null, closed: false };
    this.open.set(execId, entry);
    port1.on('message', (e) => this.onPageMessage(execId, e.data));
    port1.start();
    target.postMessage(EVENTS.terminalPort, { execId, channelId }, [port2]);
    try {
      entry.detach = await this.deps.executions.attach(execId, {
        onData: (offset, bytes) => this.post(entry, { type: 'data', offset, bytes }),
        onMarker: (kind, lostBytes) => {
          if (kind === 'replay-start') this.post(entry, { type: 'replay-start' });
          else if (kind === 'replay-end') this.post(entry, { type: 'replay-end' });
          else
            this.post(
              entry,
              lostBytes === undefined ? { type: 'marker', kind } : { type: 'marker', kind, lostBytes },
            );
        },
      });
    } catch (err) {
      this.deps.log.warn('terminal.attach_failed', {
        execId,
        code: err instanceof MelinnaError ? err.code : 'unknown',
      });
      this.post(entry, { type: 'replay-start' });
      this.post(entry, { type: 'replay-end' });
    }
    const after = this.deps.model.execution(execId);
    if (after && isEnded(after.status))
      this.post(entry, { type: 'exit', exitCode: after.exitCode, signal: after.signal });
    return { channelId };
  }

  /** Desanexa sem encerrar o processo. */
  async closeTerminal(execId: string): Promise<void> {
    const entry = this.open.get(execId);
    if (!entry) return;
    this.open.delete(execId);
    entry.closed = true;
    try {
      entry.port.close();
    } catch {
      // já fechado
    }
    await entry.detach?.().catch(() => undefined);
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.open.keys()].map((execId) => this.closeTerminal(execId)));
  }

  register(handle: Handle): void {
    const log = this.deps.log;
    handle(
      CHANNELS.terminal.open,
      handler(
        log,
        CHANNELS.terminal.open,
        (a) => [id(a[0], 'execução')] as [string],
        (e) => this.openTerminal(e),
      ),
    );
    handle(
      CHANNELS.terminal.close,
      handler(
        log,
        CHANNELS.terminal.close,
        (a) => [id(a[0], 'execução')] as [string],
        (e) => this.closeTerminal(e),
      ),
    );
  }

  private send(execId: string, msg: TerminalToPage): void {
    const entry = this.open.get(execId);
    if (entry) this.post(entry, msg);
  }

  private post(entry: Open, msg: TerminalToPage): void {
    if (entry.closed) return;
    try {
      entry.port.postMessage(msg);
    } catch {
      entry.closed = true;
    }
  }

  private onPageMessage(execId: string, data: unknown): void {
    if (!isObj(data)) return;
    try {
      if (data.type === 'input') {
        const bytes = toBytes(data.bytes);
        if (!bytes || bytes.length === 0 || bytes.length > LIMITS.inputBytes) return;
        this.deps.executions.write(execId, bytes);
      } else if (data.type === 'resize') {
        const { cols, rows } = data;
        if (typeof cols !== 'number' || typeof rows !== 'number') return;
        if (!Number.isInteger(cols) || !Number.isInteger(rows)) return;
        if (
          cols < LIMITS.cols.min ||
          cols > LIMITS.cols.max ||
          rows < LIMITS.rows.min ||
          rows > LIMITS.rows.max
        )
          return;
        this.deps.executions.resize(execId, { cols, rows });
      } else if (data.type === 'ack') {
        if (typeof data.offset === 'number' && Number.isSafeInteger(data.offset) && data.offset >= 0) {
          this.deps.executions.ack(execId, data.offset);
        }
      }
    } catch (err) {
      if (!(err instanceof MelinnaError))
        this.deps.log.error('terminal.page_message_failed', { execId, err });
    }
  }
}
