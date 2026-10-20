import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../src/renderer/api';
import {
  ACK_EVERY_BYTES,
  TerminalDepsContext,
  TerminalView,
  type TerminalDeps,
} from '../../../src/renderer/components/TerminalView';
import type { PortReceiver } from '../../../src/renderer/terminal/port-receiver';
import type { TerminalLike } from '../../../src/renderer/terminal/xterm-types';
import { fakeApi } from '../../support/fake-api';

class FakeTerm implements TerminalLike {
  cols = 80;
  rows = 24;
  writes: (Uint8Array | string)[] = [];
  proposed: { cols: number; rows: number } | null = { cols: 100, rows: 30 };
  opened = false;
  disposed = false;
  private dataFns: ((d: string) => void)[] = [];
  private fallbackFns: (() => void)[] = [];
  open() {
    this.opened = true;
  }
  write(data: Uint8Array | string, cb?: () => void) {
    this.writes.push(data);
    cb?.();
  }
  onData(fn: (d: string) => void) {
    this.dataFns.push(fn);
    return { dispose: () => undefined };
  }
  onBinary() {
    return { dispose: () => undefined };
  }
  focus() {}
  dispose() {
    this.disposed = true;
  }
  proposeSize() {
    return this.proposed;
  }
  fit() {}
  onRendererFallback(fn: () => void) {
    this.fallbackFns.push(fn);
  }
  search() {
    return false;
  }
  clearSearch() {}
  type(d: string) {
    for (const fn of this.dataFns) fn(d);
  }
  loseWebgl() {
    for (const fn of this.fallbackFns) fn();
  }
  text() {
    return this.writes.map((w) => (typeof w === 'string' ? w : new TextDecoder().decode(w))).join('');
  }
}

const tick = (ms = 0) => act(() => new Promise((r) => setTimeout(r, ms)));

let resizeFns: (() => void)[] = [];
beforeEach(() => {
  resizeFns = [];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(() => {
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});

function setup(props: { visible?: boolean; onExit?: () => void; onRendererFallback?: () => void } = {}) {
  const api = fakeApi();
  const term = new FakeTerm();
  const channel = new MessageChannel();
  const fromPage: unknown[] = [];
  channel.port1.onmessage = (e) => fromPage.push(e.data);
  const receiver: PortReceiver = {
    expect: () => ({ take: async () => channel.port2, cancel: () => undefined }),
    dispose: () => undefined,
  };
  const deps: TerminalDeps = {
    factory: () => term,
    receiver,
    observeResize: (_el, fn) => {
      resizeFns.push(fn);
      return () => undefined;
    },
  };
  const utils = render(
    <ApiContext.Provider value={api}>
      <TerminalDepsContext.Provider value={deps}>
        <TerminalView execId="e1" visible={props.visible ?? true} {...props} />
      </TerminalDepsContext.Provider>
    </ApiContext.Provider>,
  );
  const fromMain = (msg: unknown) => channel.port1.postMessage(msg);
  return { api, term, fromPage, fromMain, utils };
}

describe('TerminalView', () => {
  it('opens the terminal port and writes received bytes', async () => {
    const { api, term, fromMain } = setup();
    await tick();
    expect(api.terminal.open).toHaveBeenCalledWith('e1');
    fromMain({ type: 'replay-start' });
    fromMain({ type: 'data', offset: 0, bytes: new TextEncoder().encode('olá') });
    fromMain({ type: 'replay-end' });
    fromMain({ type: 'data', offset: 4, bytes: new TextEncoder().encode(' mundo') });
    await tick(10);
    expect(term.text()).toBe('olá mundo');
    expect(term.opened).toBe(true);
  });

  it('sends typed input but discards onData between replay-start and replay-end', async () => {
    const { term, fromMain, fromPage } = setup();
    await tick();
    fromMain({ type: 'replay-start' });
    await tick(5);
    term.type('\x1b[24;1R');
    fromMain({ type: 'replay-end' });
    await tick(5);
    term.type('ls\r');
    await tick(5);
    const inputs = fromPage.filter((m) => (m as { type: string }).type === 'input') as {
      bytes: Uint8Array;
    }[];
    expect(inputs.map((m) => new TextDecoder().decode(m.bytes))).toEqual(['ls\r']);
  });

  it('acks every 256 KB processed', async () => {
    const { fromMain, fromPage } = setup();
    await tick();
    const chunk = new Uint8Array(64 * 1024);
    for (let i = 0; i < 9; i++) fromMain({ type: 'data', offset: i * chunk.length, bytes: chunk });
    await tick(20);
    const acks = fromPage.filter((m) => (m as { type: string }).type === 'ack');
    expect(acks).toEqual([
      { type: 'ack', offset: ACK_EVERY_BYTES },
      { type: 'ack', offset: 2 * ACK_EVERY_BYTES },
    ]);
  });

  it('resizes with ≤ 100 ms delay, never below 20×5 and not while hidden', async () => {
    const { term, fromPage, utils } = setup();
    await tick(10);
    const resizes = () => fromPage.filter((m) => (m as { type: string }).type === 'resize');
    expect(resizes()).toEqual([{ type: 'resize', cols: 100, rows: 30 }]);
    term.proposed = { cols: 120, rows: 40 };
    resizeFns.forEach((f) => f());
    await tick(100);
    expect(resizes().at(-1)).toEqual({ type: 'resize', cols: 120, rows: 40 });
    term.proposed = { cols: 10, rows: 3 };
    resizeFns.forEach((f) => f());
    await tick(100);
    expect(resizes()).toHaveLength(2);
    utils.rerender(
      <ApiContext.Provider value={fakeApi()}>
        <div />
      </ApiContext.Provider>,
    );
  });

  it('does not send a size while hidden', async () => {
    const { fromPage } = setup({ visible: false });
    await tick(120);
    expect(fromPage.filter((m) => (m as { type: string }).type === 'resize')).toEqual([]);
  });

  it('turns discarded, gap and separator markers into visible pt-BR lines and shows the exit', async () => {
    const onExit = vi.fn();
    const { term, fromMain } = setup({ onExit });
    await tick();
    fromMain({ type: 'marker', kind: 'discarded', lostBytes: 100 });
    fromMain({ type: 'marker', kind: 'gap', lostBytes: 2048 });
    fromMain({ type: 'marker', kind: 'separator' });
    fromMain({ type: 'exit', exitCode: 3, signal: null });
    await tick(10);
    const text = term.text();
    expect(text).toContain('histórico anterior descartado (limite de 8 MB)');
    expect(text).toContain('\x1b[0m');
    expect(text).toContain('lacuna no histórico (2 KB não gravados)');
    expect(text).toContain('relançado');
    expect(text).toContain('processo encerrado (código 3)');
    expect(onExit).toHaveBeenCalledWith(3, null);
  });

  it('reports the WebGL fallback and closes the terminal on unmount without killing', async () => {
    const onRendererFallback = vi.fn();
    const { term, api, utils } = setup({ onRendererFallback });
    await tick();
    term.loseWebgl();
    expect(onRendererFallback).toHaveBeenCalled();
    utils.unmount();
    expect(api.terminal.close).toHaveBeenCalledWith('e1');
    expect(term.disposed).toBe(true);
    expect(api.executions.stop).not.toHaveBeenCalled();
  });
});
