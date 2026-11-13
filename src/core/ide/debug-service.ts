import { DAP_METHODS, ideInvalid, object } from '../../shared/ide-types';
import type { ProtocolClient } from './protocol-client';

export class DebugService {
  private initialized = false;
  private active = false;
  private configuring: Promise<void> | null = null;
  private capabilities: Record<string, unknown> = {};
  private readonly breakpoints = new Map<string, Record<string, unknown>>();
  constructor(private readonly client: Pick<ProtocolClient, 'request' | 'close'>) {}
  async initialize(): Promise<Record<string, unknown>> {
    this.capabilities = object(
      await this.client.request('initialize', {
        clientID: 'melinna',
        adapterID: 'configured',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
        supportsVariableType: true,
      }),
    );
    return this.capabilities;
  }
  async event(message: Record<string, unknown>): Promise<void> {
    if (message.event === 'terminated' || message.event === 'exited') {
      this.active = false;
      this.initialized = false;
      this.configuring = null;
      return;
    }
    if (message.event !== 'initialized' || this.configuring) return;
    this.initialized = true;
    this.configuring = (async () => {
      for (const params of this.breakpoints.values()) await this.client.request('setBreakpoints', params);
      if (this.capabilities.supportsConfigurationDoneRequest)
        await this.client.request('configurationDone', {});
    })();
    await this.configuring;
  }
  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (!DAP_METHODS.has(method)) return ideInvalid();
    if (method === 'setBreakpoints') {
      this.breakpoints.set(String(object(params.source).path), params);
      return this.initialized ? this.client.request(method, params) : {};
    }
    if (method === 'launch' || method === 'attach') {
      if (this.active) return ideInvalid('A sessão de depuração já foi iniciada.');
      this.active = true;
      try {
        return await this.client.request(method, params);
      } catch (error) {
        this.active = false;
        throw error;
      }
    }
    if (!this.active && method !== 'disconnect')
      return ideInvalid('Inicie a depuração antes desta operação.');
    return this.client.request(method, params);
  }
  close(): void {
    this.active = false;
    this.client.close();
  }
}
