import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MarkerKind } from '../../src/core/contracts/host-protocol';
import { makePaths } from '../../src/core/paths';
import { NodeHostClient } from '../../src/main/host-client';
import { ensureToken } from '../../src/host/auth';
import { currentOs, startHost, type RunningHost } from '../../src/host/start';
import { FAKE_AGENT_PATH, systemNode } from './fake-catalog';
import { MemoryLogger } from './fakes/logger';

export interface TestHost {
  userData: string;
  token: string;
  host: RunningHost;
  exits: number[];
  connect(): Promise<NodeHostClient>;
  cleanup(): Promise<void>;
}

export async function startTestHost(
  opts: { idleExitMs?: number; userData?: string } = {},
): Promise<TestHost> {
  const userData = opts.userData ?? mkdtempSync(join(tmpdir(), 'melinna-host-'));
  const paths = makePaths(userData, currentOs());
  const token = ensureToken(paths.hostToken);
  const exits: number[] = [];
  const startOpts: Parameters<typeof startHost>[0] = { userData, onExit: (c) => exits.push(c) };
  if (opts.idleExitMs !== undefined) startOpts.idleExitMs = opts.idleExitMs;
  const host = await startHost(startOpts);
  const clients: NodeHostClient[] = [];
  return {
    userData,
    token,
    host,
    exits,
    async connect() {
      const c = await NodeHostClient.connect(host.endpoint, token, new MemoryLogger());
      clients.push(c);
      return c;
    },
    async cleanup() {
      for (const c of clients) c.close();
      await host.supervisor.shutdown(500).catch(() => undefined);
      await host.stop();
      if (!opts.userData) rmSync(userData, { recursive: true, force: true });
    },
  };
}

export function fakeSpawn(execId: string, cwd: string, args: string[] = [], size = { cols: 80, rows: 24 }) {
  return {
    execId,
    file: systemNode(),
    args: [FAKE_AGENT_PATH, ...args],
    cwd,
    env: {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      MELINNA_EXECUTION_ID: execId,
    },
    cols: size.cols,
    rows: size.rows,
  };
}

export interface Collector {
  text(): string;
  bytes(): number;
  markers: MarkerKind[];
  offsets: { offset: number; length: number }[];
  sink: {
    onData(offset: number, bytes: Uint8Array): void;
    onMarker(kind: MarkerKind, lostBytes?: number): void;
  };
  waitFor(pattern: RegExp | string, timeoutMs?: number): Promise<string>;
}

export function collector(onChunk?: (offset: number, bytes: Uint8Array) => void): Collector {
  const chunks: Buffer[] = [];
  const markers: MarkerKind[] = [];
  const offsets: { offset: number; length: number }[] = [];
  let total = 0;
  const waiters: (() => void)[] = [];
  const text = () => Buffer.concat(chunks).toString('utf8');
  return {
    text,
    bytes: () => total,
    markers,
    offsets,
    sink: {
      onData(offset, bytes) {
        chunks.push(Buffer.from(bytes));
        offsets.push({ offset, length: bytes.length });
        total += bytes.length;
        onChunk?.(offset, bytes);
        for (const w of waiters.splice(0)) w();
      },
      onMarker(kind) {
        markers.push(kind);
        for (const w of waiters.splice(0)) w();
      },
    },
    waitFor(pattern, timeoutMs = 10_000) {
      const matches = () => (typeof pattern === 'string' ? text().includes(pattern) : pattern.test(text()));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(
                `timeout esperando ${String(pattern)}; recebido: ${JSON.stringify(text().slice(-500))}`,
              ),
            ),
          timeoutMs,
        );
        const check = () => {
          if (matches()) {
            clearTimeout(timer);
            resolve(text());
          } else {
            waiters.push(check);
          }
        };
        check();
      });
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
