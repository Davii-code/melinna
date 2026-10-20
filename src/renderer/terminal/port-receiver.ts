import { TERMINAL_PORT_SOURCE } from '../../shared/ipc-contract';

interface Arrival {
  channelId: string;
  port: MessagePort;
}

interface Waiting {
  arrivals: Arrival[];
  wake: (() => void) | null;
}

export interface PortReceiver {
  /** Registra a espera antes de `terminal.open`; `take(channelId)` devolve o port com esse id. */
  expect(execId: string): {
    take(channelId: string, timeoutMs?: number): Promise<MessagePort>;
    cancel(): void;
  };
  dispose(): void;
}

/**
 * Recebe os MessagePorts que o preload repassa com `window.postMessage`. Aceita só mensagens da própria janela,
 * da mesma origem, com `source: 'melinna-terminal'` e para uma execução cuja abertura está pendente.
 */
export function createPortReceiver(win: Window): PortReceiver {
  const pending = new Map<string, Waiting>();
  const onMessage = (event: MessageEvent) => {
    if (event.source !== win) return;
    if (event.origin !== win.location.origin) return;
    const data = event.data as { source?: unknown; execId?: unknown; channelId?: unknown } | null;
    if (!data || data.source !== TERMINAL_PORT_SOURCE) return;
    if (typeof data.execId !== 'string' || typeof data.channelId !== 'string') return;
    const waiting = pending.get(data.execId);
    const port = event.ports[0];
    if (!waiting || !port) return;
    waiting.arrivals.push({ channelId: data.channelId, port });
    waiting.wake?.();
  };
  win.addEventListener('message', onMessage);
  return {
    expect(execId) {
      const waiting: Waiting = { arrivals: [], wake: null };
      pending.set(execId, waiting);
      const cancel = () => {
        if (pending.get(execId) !== waiting) return;
        pending.delete(execId);
        waiting.wake?.();
      };
      return {
        cancel,
        take(channelId, timeoutMs = 10_000) {
          return new Promise<MessagePort>((resolve, reject) => {
            let settled = false;
            const settle = (fn: () => void) => {
              if (settled) return;
              settled = true;
              waiting.wake = null;
              clearTimeout(timer);
              fn();
            };
            const timer = setTimeout(() => {
              settle(() => reject(new Error('port do terminal não chegou')));
              cancel();
            }, timeoutMs);
            const check = () => {
              const hit = waiting.arrivals.find((a) => a.channelId === channelId);
              if (hit) {
                settle(() => resolve(hit.port));
                for (const other of waiting.arrivals) if (other !== hit) other.port.close();
                cancel();
                return;
              }
              if (pending.get(execId) !== waiting) {
                settle(() => reject(new Error('abertura cancelada')));
                return;
              }
              waiting.wake = check;
            };
            check();
          });
        },
      };
    },
    dispose() {
      win.removeEventListener('message', onMessage);
      pending.clear();
    },
  };
}
