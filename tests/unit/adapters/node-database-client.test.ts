import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ workers: [] as unknown[] }));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      requests: { id: string; sql: string }[] = [];
      terminate = vi.fn(async () => 0);
      constructor() {
        super();
        state.workers.push(this);
        queueMicrotask(() => this.emit('message', { ready: true }));
      }
      postMessage(message: { id: string; sql: string }) {
        this.requests.push(message);
      }
    },
  };
});
import { NodeDatabaseClient } from '../../../src/adapters/node-database-client';
type TestWorker = EventEmitter & {
  requests: { id: string; sql: string }[];
  terminate: ReturnType<typeof vi.fn>;
};
afterEach(() => {
  vi.useRealTimers();
  state.workers.length = 0;
});
describe('SQLite worker lifecycle', () => {
  it('terminates a slow query and rejects pending work', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const client = new NodeDatabaseClient(async (path) => path);
    const id = await client.open('/repo/db.sqlite');
    const pending = client.query(id, 'SELECT 1');
    const check = expect(pending).rejects.toThrow();
    await Promise.resolve();
    vi.advanceTimersByTime(10_000);
    await check;
    expect((state.workers[0] as TestWorker).terminate).toHaveBeenCalledOnce();
    await expect(client.query(id, 'SELECT 1')).rejects.toThrow();
  });
  it('checks root authorization again before each query and bounds concurrent requests', async () => {
    const validate = vi.fn(async (path: string) => path);
    const client = new NodeDatabaseClient(validate);
    const id = await client.open('/repo/db.sqlite');
    const pending = client.query(id, 'SELECT 1');
    await Promise.resolve();
    const worker = state.workers[0] as TestWorker;
    await expect(client.query(id, 'SELECT 2')).rejects.toThrow();
    const request = worker.requests[0]!;
    worker.emit('message', { id: request.id, result: { columns: ['n'], rows: [[1]], truncated: false } });
    await expect(pending).resolves.toMatchObject({ rows: [[1]] });
    validate.mockRejectedValueOnce(new Error('outside'));
    await expect(client.query(id, 'SELECT 1')).rejects.toThrow('outside');
    client.closeAll();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
