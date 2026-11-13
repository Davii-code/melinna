import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { MelinnaError } from '../core/errors';
import { type QueryOutput, toolString, ideInvalid } from '../shared/ide-types';
import { SQLITE_WORKER } from './sqlite-worker';

interface Connection {
  path: string;
  worker: Worker;
  pending: Map<
    string,
    { resolve(value: QueryOutput): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >;
}
export class NodeDatabaseClient {
  private readonly connections = new Map<string, Connection>();
  private disposed = false;
  constructor(private readonly validatePath: (path: string) => Promise<string>) {}
  async open(rawPath: string): Promise<string> {
    if (this.disposed) return ideInvalid('As conexões SQLite foram encerradas.');
    if (this.connections.size >= 4) throw new MelinnaError('LIMIT_REACHED');
    const path = await this.validatePath(toolString(rawPath));
    if (this.disposed) return ideInvalid('As conexões SQLite foram encerradas.');
    if (this.connections.size >= 4) throw new MelinnaError('LIMIT_REACHED');
    const id = randomUUID();
    const worker = new Worker(SQLITE_WORKER, { eval: true, workerData: { path } });
    const connection: Connection = { path, worker, pending: new Map() };
    this.connections.set(id, connection);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new MelinnaError('IO_ERROR', { userMessage: 'Tempo excedido ao abrir SQLite.' }));
        }, 10_000);
        const cleanup = () => {
          clearTimeout(timer);
          worker.off('message', ready);
          worker.off('error', failed);
          worker.off('exit', exited);
        };
        const failed = () => {
          cleanup();
          reject(new MelinnaError('IO_ERROR', { userMessage: 'Não foi possível iniciar SQLite.' }));
        };
        const exited = () => failed();
        const ready = (message: { ready?: boolean; error?: string }) => {
          cleanup();
          if (message.ready) resolve();
          else reject(new MelinnaError('IO_ERROR', { userMessage: message.error ?? 'Banco indisponível.' }));
        };
        worker.once('message', ready);
        worker.once('error', failed);
        worker.once('exit', exited);
      });
    } catch (error) {
      this.close(id);
      throw error;
    }
    worker.on('message', (message: { id: string; result?: QueryOutput; error?: string }) => {
      const pending = connection.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      connection.pending.delete(message.id);
      if (message.result) pending.resolve(message.result);
      else
        pending.reject(new MelinnaError('IO_ERROR', { userMessage: message.error ?? 'Consulta recusada.' }));
    });
    worker.on('error', () => this.close(id));
    worker.on('exit', () => this.close(id));
    return id;
  }
  async query(id: string, sql: string): Promise<QueryOutput> {
    if (typeof sql !== 'string' || !sql.trim() || sql.length > 65536) return ideInvalid();
    const connection = this.connections.get(id);
    if (!connection) return ideInvalid('Conexão SQLite não encontrada.');
    await this.validatePath(connection.path);
    if (this.connections.get(id) !== connection) return ideInvalid('Conexão encerrada.');
    if (connection.pending.size) return ideInvalid('Aguarde a consulta atual terminar.');
    const request = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(id), 10_000);
      connection.pending.set(request, { resolve, reject, timer });
      connection.worker.postMessage({ id: request, sql });
    });
  }
  close(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    for (const pending of connection.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new MelinnaError('IO_ERROR', { userMessage: 'Conexão encerrada ou consulta excedeu 10 segundos.' }),
      );
    }
    connection.pending.clear();
    void connection.worker.terminate();
  }
  closeAll(): void {
    this.disposed = true;
    for (const id of this.connections.keys()) this.close(id);
  }
}
