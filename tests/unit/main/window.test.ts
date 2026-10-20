import { describe, expect, it } from 'vitest';
import { resolveAppFile } from '../../../src/main/app-protocol';
import {
  CONTENT_SECURITY_POLICY,
  createMainWindow,
  type BrowserWindowLike,
  type BrowserWindowOptions,
} from '../../../src/main/window';

function fakeWindow() {
  const handlers: Record<string, (...a: never[]) => unknown> = {};
  let headerHook:
    | ((
        d: { responseHeaders?: Record<string, string[]> },
        cb: (r: { responseHeaders: Record<string, string[]> }) => void,
      ) => void)
    | undefined;
  let openHandler: ((d: { url: string }) => { action: string }) | undefined;
  const state = { shown: false, loaded: '' };
  const win: BrowserWindowLike = {
    webContents: {
      getURL: () => 'app://melinna/index.html',
      on: (ev, fn) => (handlers[ev] = fn as never),
      setWindowOpenHandler: (fn) => (openHandler = fn),
      session: { webRequest: { onHeadersReceived: (fn) => (headerHook = fn) } },
    },
    once: (ev, fn) => (handlers[ev] = fn as never),
    show: () => (state.shown = true),
    loadURL: async (url) => {
      state.loaded = url;
    },
  };
  return { win, handlers, state, headerHook: () => headerHook, openHandler: () => openHandler };
}

describe('main window', () => {
  it('uses sandbox, context isolation and no node integration', () => {
    let opts: BrowserWindowOptions | undefined;
    const f = fakeWindow();
    createMainWindow({
      create: (o) => ((opts = o), f.win),
      preloadPath: '/p/preload.js',
      url: 'app://melinna/index.html',
    });
    expect(opts?.webPreferences).toMatchObject({
      preload: '/p/preload.js',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
    expect(opts?.backgroundColor).toBe('#07080b');
    expect(f.state.loaded).toBe('app://melinna/index.html');
  });

  it('sets the restricted CSP on responses', () => {
    const f = fakeWindow();
    createMainWindow({ create: () => f.win, preloadPath: '/p', url: 'app://melinna/' });
    let headers: Record<string, string[]> = {};
    f.headerHook()!({ responseHeaders: { X: ['1'] } }, (r) => (headers = r.responseHeaders));
    expect(headers['Content-Security-Policy']).toEqual([
      "default-src 'self'; style-src 'self' 'unsafe-inline'",
    ]);
    expect(CONTENT_SECURITY_POLICY).toBe("default-src 'self'; style-src 'self' 'unsafe-inline'");
    expect(headers.X).toEqual(['1']);
  });

  it('blocks navigation and denies new windows', () => {
    const f = fakeWindow();
    createMainWindow({ create: () => f.win, preloadPath: '/p', url: 'app://melinna/' });
    let prevented = false;
    (f.handlers['will-navigate'] as unknown as (e: { preventDefault(): void }, url: string) => void)(
      { preventDefault: () => (prevented = true) },
      'https://evil.example',
    );
    expect(prevented).toBe(true);
    expect(f.openHandler()!({ url: 'https://x' })).toEqual({ action: 'deny' });
    (f.handlers['ready-to-show'] as unknown as () => void)();
    expect(f.state.shown).toBe(true);
  });
});

describe('app protocol', () => {
  it('serves only files inside the renderer root', () => {
    expect(resolveAppFile('/out/renderer', 'app://melinna/')).toBe('/out/renderer/index.html');
    expect(resolveAppFile('/out/renderer', 'app://melinna/assets/a.js')).toBe('/out/renderer/assets/a.js');
    expect(resolveAppFile('/out/renderer', 'app://melinna/../../etc/passwd')).toBe(
      '/out/renderer/etc/passwd',
    );
    // o parser de URL já resolve `..` (também codificado), então nada escapa da raiz
    expect(resolveAppFile('/out/renderer', 'app://melinna/%2e%2e/%2e%2e/etc/passwd')).toBe(
      '/out/renderer/etc/passwd',
    );
    expect(resolveAppFile('/out/renderer', 'app://melinna/a%00b')).toBeNull();
    expect(resolveAppFile('/out/renderer', 'app://outro/index.html')).toBeNull();
    expect(resolveAppFile('/out/renderer', 'file:///etc/passwd')).toBeNull();
  });
});
