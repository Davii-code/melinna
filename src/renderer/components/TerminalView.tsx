import { createContext, useContext, useEffect, useRef } from 'react';
import { LIMITS, type TerminalToPage } from '../../shared/ipc-contract';
import { useApi } from '../api';
import { exitLine, markerLine } from '../terminal/messages';
import type { PortReceiver } from '../terminal/port-receiver';
import type { TerminalFactory, TerminalLike } from '../terminal/xterm-types';

export const ACK_EVERY_BYTES = 256 * 1024;
export const RESIZE_DEBOUNCE_MS = 80;

export interface TerminalDeps {
  factory: TerminalFactory;
  receiver: PortReceiver;
  /** Observa mudanças de tamanho do elemento (ResizeObserver no app; manual nos testes). */
  observeResize: (el: HTMLElement, fn: () => void) => () => void;
}

export const TerminalDepsContext = createContext<TerminalDeps | null>(null);

export interface TerminalHandle {
  term: TerminalLike;
  refit(): void;
}

export interface TerminalViewProps {
  execId: string;
  visible: boolean;
  onExit?: (exitCode: number | null, signal: string | null) => void;
  onReady?: (handle: TerminalHandle | null) => void;
  onRendererFallback?: () => void;
  /**
   * Chamado quando o usuário aperta Ctrl+V e a área de transferência tem uma imagem e nenhum texto. A
   * colagem de texto segue o caminho normal do xterm: sem texto na área de transferência, não cola nada.
   */
  onPasteImage?: () => void;
}

const encoder = new TextEncoder();

/** Terminal de um painel: anexa ao PTY pelo MessagePort dedicado e o mantém do tamanho do elemento. */
export function TerminalView({
  execId,
  visible,
  onExit,
  onReady,
  onRendererFallback,
  onPasteImage,
}: TerminalViewProps) {
  const api = useApi();
  const deps = useContext(TerminalDepsContext);
  if (!deps) throw new Error('TerminalDepsContext ausente');
  const hostRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const refitRef = useRef<() => void>(() => undefined);
  const callbacks = useRef({ onExit, onReady, onRendererFallback, onPasteImage });
  callbacks.current = { onExit, onReady, onRendererFallback, onPasteImage };

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) refitRef.current();
  }, [visible]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let disposed = false;
    let port: MessagePort | null = null;
    let replaying = false;
    let processedSinceAck = 0;
    let lastSize = { cols: 0, rows: 0 };
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const term = deps.factory({ openLink: (url) => void api.app.openExternal(url) });
    term.open(el);
    term.onRendererFallback(() => callbacks.current.onRendererFallback?.());

    // Ctrl+V: a colagem de texto não muda (a tecla segue para o xterm); em paralelo o main diz se a área
    // de transferência tem só imagem. Ctrl+Shift+V cola sempre só texto.
    term.attachCustomKeyEventHandler((e) => {
      const paste = e.type === 'keydown' && !e.repeat && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
      if (!paste || e.key.toLowerCase() !== 'v' || !callbacks.current.onPasteImage) return true;
      void api.attachments.clipboardHasImage().then((r) => {
        if (r.ok && r.value && !disposed) callbacks.current.onPasteImage?.();
      });
      return true;
    });

    const send = (msg: unknown, transfer?: Transferable[]) => {
      if (!port) return;
      try {
        if (transfer) port.postMessage(msg, transfer);
        else port.postMessage(msg);
      } catch {
        port = null;
      }
    };

    const sendInput = (text: string, binary: boolean) => {
      if (replaying) return;
      const bytes = binary ? Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff) : encoder.encode(text);
      for (let i = 0; i < bytes.length; i += LIMITS.inputBytes)
        send({ type: 'input', bytes: bytes.slice(i, i + LIMITS.inputBytes) });
    };
    const dataSub = term.onData((d) => sendInput(d, false));
    const binSub = term.onBinary((d) => sendInput(d, true));

    const refit = () => {
      if (!visibleRef.current || el.clientWidth === 0 || el.clientHeight === 0) return;
      const proposed = term.proposeSize();
      if (!proposed || !Number.isFinite(proposed.cols) || !Number.isFinite(proposed.rows)) return;
      if (proposed.cols < LIMITS.cols.min || proposed.rows < LIMITS.rows.min) return;
      term.fit();
      const size = {
        cols: Math.min(proposed.cols, LIMITS.cols.max),
        rows: Math.min(proposed.rows, LIMITS.rows.max),
      };
      if (size.cols === lastSize.cols && size.rows === lastSize.rows) return;
      lastSize = size;
      send({ type: 'resize', ...size });
    };
    const scheduleRefit = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        refit();
      }, RESIZE_DEBOUNCE_MS);
    };
    refitRef.current = () => {
      lastSize = { cols: 0, rows: 0 };
      scheduleRefit();
    };
    const stopObserving = deps.observeResize(el, scheduleRefit);

    const onMessage = (event: MessageEvent<TerminalToPage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'data': {
          const end = msg.offset + msg.bytes.length;
          term.write(msg.bytes, () => {
            processedSinceAck += msg.bytes.length;
            if (processedSinceAck >= ACK_EVERY_BYTES) {
              processedSinceAck = 0;
              send({ type: 'ack', offset: end });
            }
          });
          return;
        }
        case 'replay-start':
          replaying = true;
          return;
        case 'replay-end':
          // as respostas automáticas do xterm às consultas reproduzidas são geradas na escrita; descarta-as até aqui
          term.write('', () => {
            replaying = false;
          });
          return;
        case 'marker': {
          const line = markerLine(msg.kind, msg.lostBytes);
          if (line) term.write(line);
          return;
        }
        case 'exit':
          term.write(exitLine(msg.exitCode, msg.signal));
          callbacks.current.onExit?.(msg.exitCode, msg.signal);
          return;
      }
    };

    const waiter = deps.receiver.expect(execId);
    void (async () => {
      const r = await api.terminal.open(execId);
      if (!r.ok || disposed) {
        waiter.cancel();
        if (!r.ok) term.write(`\x1b[31m${r.error.message}\x1b[0m\r\n`);
        return;
      }
      try {
        const p = await waiter.take(r.value.channelId);
        if (disposed) {
          p.close();
          return;
        }
        port = p;
        p.onmessage = onMessage;
        p.start();
        lastSize = { cols: 0, rows: 0 };
        refit();
        callbacks.current.onReady?.({ term, refit: () => refitRef.current() });
      } catch {
        term.write('\x1b[31mNão foi possível conectar o terminal.\x1b[0m\r\n');
      }
    })();

    return () => {
      disposed = true;
      waiter.cancel();
      stopObserving();
      if (resizeTimer) clearTimeout(resizeTimer);
      dataSub.dispose();
      binSub.dispose();
      port?.close();
      port = null;
      void api.terminal.close(execId);
      callbacks.current.onReady?.(null);
      term.dispose();
    };
  }, [execId, api, deps]);

  return <div className="terminal-host" ref={hostRef} data-testid={`terminal-${execId}`} />;
}
