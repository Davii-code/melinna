import { IDE_LIMITS, type ToolProtocol } from '../../shared/ide-types';
import { MelinnaError } from '../errors';
import type { Clock, Cancel } from '../ports/clock';
import type { ProtocolProcess } from '../ports/protocol-process';
import { MessageFramer, encodeMessage } from './framing';

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cancel: Cancel;
}
export class ProtocolClient {
  private seq = 0;
  private closed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly off: (() => void)[] = [];
  constructor(
    readonly protocol: ToolProtocol,
    private readonly process: ProtocolProcess,
    private readonly clock: Clock,
    private readonly event: (message: Record<string, unknown>) => void,
    private readonly serverRequest?: (method: string, params: unknown) => unknown,
  ) {
    const parser = new MessageFramer();
    const offData = process.onData((bytes) => {
      try {
        for (const message of parser.push(bytes)) this.receive(message);
      } catch {
        this.close();
      }
    });
    if (this.closed) offData();
    else this.off.push(offData);
    const offExit = process.onExit(() => this.close());
    if (this.closed) offExit();
    else this.off.push(offExit);
  }
  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(this.error('A ferramenta foi encerrada.'));
    if (this.pending.size >= IDE_LIMITS.pending) return Promise.reject(new MelinnaError('LIMIT_REACHED'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const cancel = this.clock.setTimeout(() => {
        this.pending.delete(id);
        try {
          if (this.protocol === 'lsp') this.notify('$/cancelRequest', { id });
        } catch {
          this.close();
        }
        reject(this.error('A ferramenta não respondeu a tempo.'));
      }, IDE_LIMITS.timeout);
      this.pending.set(id, { resolve, reject, cancel });
      try {
        this.send(
          this.protocol === 'lsp'
            ? { jsonrpc: '2.0', id, method, params }
            : { seq: id, type: 'request', command: method, arguments: params },
        );
      } catch {
        this.pending.delete(id);
        cancel();
        reject(this.error('Não foi possível enviar à ferramenta.'));
      }
    });
  }
  notify(method: string, params: Record<string, unknown>): void {
    if (!this.closed) this.send({ jsonrpc: '2.0', method, params });
  }
  private send(message: Record<string, unknown>): void {
    this.process.write(encodeMessage(message));
  }
  private receive(message: Record<string, unknown>): void {
    const id = this.protocol === 'lsp' ? message.id : message.request_seq;
    const response = this.protocol === 'lsp' ? !('method' in message) : message.type === 'response';
    if (response && typeof id === 'number') {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.cancel();
      if (message.error || message.success === false)
        pending.reject(this.error('A ferramenta recusou a operação.'));
      else pending.resolve(this.protocol === 'lsp' ? message.result : message.body);
      return;
    }
    // Servidores não podem iniciar comandos ou aplicar alterações por conta própria.
    if (this.protocol === 'lsp' && 'id' in message && typeof message.method === 'string') {
      if (this.serverRequest) {
        try {
          const result = this.serverRequest(message.method, message.params);
          this.send({ jsonrpc: '2.0', id: message.id, result });
          return;
        } catch {
          /* Operações não negociadas são recusadas abaixo. */
        }
      }
      this.send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Client operation unsupported' },
      });
      return;
    }
    if (this.protocol === 'dap' && message.type === 'request') {
      this.send({
        seq: ++this.seq,
        type: 'response',
        request_seq: message.seq,
        command: message.command,
        success: false,
        message: 'Reverse requests unsupported',
      });
      return;
    }
    this.event(message);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const off of this.off) off();
    for (const pending of this.pending.values()) {
      pending.cancel();
      pending.reject(this.error('A ferramenta foi encerrada.'));
    }
    this.pending.clear();
    this.process.close();
    this.event({ kind: 'closed' });
  }
  private error(message: string): MelinnaError {
    return new MelinnaError('IO_ERROR', { userMessage: message });
  }
}
