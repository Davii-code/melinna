import type { ToolStart } from '../../shared/ide-types';
export interface ProtocolProcess {
  write(bytes: Uint8Array): void;
  onData(fn: (bytes: Uint8Array) => void): () => void;
  onExit(fn: () => void): () => void;
  close(): void;
}
export interface ProtocolProcessFactory {
  start(input: ToolStart): Promise<ProtocolProcess>;
}
