import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { DelegationBridge } from '../../core/orchestration/ports';

const tools = [
  {
    name: 'delegate_task',
    description:
      'Delegate a bounded task to a configured worker role. Returns immediately with jobId. Use a stable unique requestKey for idempotency.',
    inputSchema: {
      type: 'object',
      properties: { roleId: { type: 'string' }, prompt: { type: 'string' }, requestKey: { type: 'string' } },
      required: ['roleId', 'prompt', 'requestKey'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_task',
    description: 'Read a managed job status and concise result.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
  {
    name: 'collect_results',
    description: 'Get current statuses and results of managed jobs in this run.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wait_tasks',
    description:
      'Wait up to twenty seconds for managed jobs. Pending jobs may be delivered in a later coordinator turn.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a managed worker job in this run.',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false,
    },
  },
];

/** Stateless Streamable HTTP MCP. Tokens are capability-scoped to one run. */
export class LocalDelegationBridge implements DelegationBridge {
  private server: Server | undefined;
  private starting: Promise<void> | undefined;
  private port = 0;
  private tokens = new Map<string, string>();
  constructor(private readonly call: (runId: string, tool: string, args: unknown) => Promise<unknown>) {}
  async open(runId: string): Promise<{ url: string; token: string }> {
    if (!this.starting) this.starting = this.listen();
    await this.starting;
    const token = randomBytes(32).toString('hex');
    this.tokens.set(runId, token);
    return { url: 'http://127.0.0.1:' + this.port + '/mcp', token };
  }
  revoke(runId: string): void {
    this.tokens.delete(runId);
  }
  private async listen(): Promise<void> {
    const server = createServer((req, res) => {
      void this.request(req, res);
    });
    this.server = server;
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Não foi possível iniciar a ponte local.');
    this.port = address.port;
  }
  private send(res: ServerResponse, status: number, payload?: unknown): void {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(payload === undefined ? undefined : JSON.stringify(payload));
  }
  private async request(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.url !== '/mcp' || req.headers.host !== '127.0.0.1:' + this.port || req.headers.origin) {
        this.send(res, 403);
        return;
      }
      const auth = req.headers.authorization;
      if (!auth?.startsWith('Bearer ')) {
        this.send(res, 401);
        return;
      }
      const provided = Buffer.from(auth.slice(7));
      const entry = [...this.tokens].find(([, token]) => {
        const expected = Buffer.from(token);
        return provided.length === expected.length && timingSafeEqual(provided, expected);
      });
      if (!entry) {
        this.send(res, 401);
        return;
      }
      if (req.method === 'GET') {
        this.send(res, 405);
        return;
      }
      if (req.method !== 'POST') {
        this.send(res, 405);
        return;
      }
      if (!req.headers['content-type']?.includes('application/json')) {
        this.send(res, 415);
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        if (bytes > 128 * 1024) {
          this.send(res, 413);
          req.destroy();
          return;
        }
        chunks.push(buffer);
      }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        jsonrpc?: string;
        id?: number | string;
        method?: string;
        params?: { name?: string; arguments?: unknown; protocolVersion?: string };
      };
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        this.send(res, 400);
        return;
      }
      if (message.id === undefined) {
        this.send(res, 202);
        return;
      }
      const reply = (result: unknown) => this.send(res, 200, { jsonrpc: '2.0', id: message.id, result });
      if (message.method === 'initialize') {
        const requested = message.params?.protocolVersion;
        reply({
          protocolVersion: requested === '2025-03-26' ? requested : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'melinna-orchestration', version: '1.0.0' },
        });
        return;
      }
      if (message.method === 'ping') {
        reply({});
        return;
      }
      if (message.method === 'tools/list') {
        reply({ tools });
        return;
      }
      if (message.method === 'tools/call') {
        try {
          const name = message.params?.name;
          if (typeof name !== 'string' || !tools.some((t) => t.name === name))
            throw new Error('Ferramenta não autorizada.');
          const result = await this.call(entry[0], name, message.params?.arguments ?? {});
          reply({ content: [{ type: 'text', text: JSON.stringify(result) }] });
        } catch (err) {
          reply({
            isError: true,
            content: [{ type: 'text', text: err instanceof Error ? err.message : 'Falha na delegação.' }],
          });
        }
        return;
      }
      this.send(res, 200, {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: 'Method not found' },
      });
    } catch {
      this.send(res, 400, { error: 'Invalid MCP request' });
    }
  }
  async close(): Promise<void> {
    this.tokens.clear();
    const server = this.server;
    if (!server) return;
    server.closeIdleConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    this.server = undefined;
    this.starting = undefined;
  }
}
