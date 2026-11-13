import { describe, expect, it } from 'vitest';
import {
  BROWSER_PARTITION,
  BrowserPane,
  type BrowserContentsLike,
  type BrowserViewLike,
  type BrowserViewOptions,
} from '../../../src/main/browser-pane';
import type { BrowserBounds, BrowserState } from '../../../src/shared/browser-types';
import { MemoryLogger } from '../../support/fakes/logger';

const BOUNDS: BrowserBounds = { x: 10, y: 60, width: 800, height: 500 };

function fakeView() {
  const handlers: Record<string, (...a: never[]) => unknown> = {};
  const sessionHandlers: Record<string, (...a: never[]) => unknown> = {};
  let openHandler: ((d: { url: string }) => { action: 'deny' }) | undefined;
  let permissionHandler:
    | ((contents: unknown, permission: string, cb: (granted: boolean) => void) => void)
    | undefined;
  const s = {
    url: '',
    title: '',
    loading: false,
    back: false,
    forward: false,
    loads: [] as string[],
    bounds: [] as BrowserBounds[],
    closed: false,
    reloads: 0,
    stops: 0,
    wentBack: 0,
    wentForward: 0,
    failLoad: false,
  };
  const webContents: BrowserContentsLike = {
    loadURL: async (url) => {
      s.loads.push(url);
      s.url = url;
      if (s.failLoad) throw new Error('ERR_CONNECTION_REFUSED');
    },
    getURL: () => s.url,
    getTitle: () => s.title,
    isLoading: () => s.loading,
    reload: () => void s.reloads++,
    stop: () => void s.stops++,
    close: () => {
      s.closed = true;
    },
    navigationHistory: {
      canGoBack: () => s.back,
      canGoForward: () => s.forward,
      goBack: () => void s.wentBack++,
      goForward: () => void s.wentForward++,
    },
    on: (event: string, fn: (...a: never[]) => unknown) => {
      handlers[event] = fn;
    },
    setWindowOpenHandler: (fn) => {
      openHandler = fn;
    },
    session: {
      setPermissionRequestHandler: (fn) => {
        permissionHandler = fn;
      },
      on: (event, fn) => {
        sessionHandlers[event] = fn as never;
      },
    },
  };
  const view: BrowserViewLike = { webContents, setBounds: (b) => void s.bounds.push(b) };
  const fire = (event: string, ...args: unknown[]) =>
    (handlers[event] as ((...a: unknown[]) => unknown) | undefined)?.(...args);
  return {
    view,
    s,
    fire,
    open: (url: string) => openHandler?.({ url }),
    askPermission: (permission: string) => {
      let granted: boolean | undefined;
      permissionHandler?.(null, permission, (g) => {
        granted = g;
      });
      return granted;
    },
    download: () => {
      let prevented = false;
      (sessionHandlers['will-download'] as ((e: { preventDefault(): void }) => void) | undefined)?.({
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
  };
}

function setup() {
  const fake = fakeView();
  const created: BrowserViewOptions[] = [];
  const attached: BrowserViewLike[] = [];
  const detached: BrowserViewLike[] = [];
  const states: BrowserState[] = [];
  const log = new MemoryLogger();
  const pane = new BrowserPane({
    create: (opts) => {
      created.push(opts);
      return fake.view;
    },
    attach: (v) => void attached.push(v),
    detach: (v) => void detached.push(v),
    emit: (state) => void states.push(state),
    log,
  });
  return { pane, fake, created, attached, detached, states, log };
}

function navigation(fake: ReturnType<typeof fakeView>, event: string, url: string): boolean {
  let prevented = false;
  fake.fire(
    event,
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    url,
  );
  return prevented;
}

describe('BrowserPane', () => {
  it('creates an isolated view: own session, sandbox, no node and no preload', () => {
    const { pane, created } = setup();
    pane.open('https://example.com/', BOUNDS);
    expect(created).toEqual([
      {
        webPreferences: {
          partition: BROWSER_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
        },
      },
    ]);
    expect(created[0]?.webPreferences).not.toHaveProperty('preload');
  });

  it('opens the page at the given rectangle and reuses the view on the next open', () => {
    const { pane, fake, created, attached } = setup();
    pane.open('http://localhost:3000', BOUNDS);
    pane.open('https://example.com/docs', { ...BOUNDS, width: 900 });
    expect(created).toHaveLength(1);
    expect(attached).toHaveLength(1);
    expect(fake.s.loads).toEqual(['http://localhost:3000/', 'https://example.com/docs']);
    expect(fake.s.bounds).toEqual([BOUNDS, { ...BOUNDS, width: 900 }]);
  });

  it('refuses anything that is not http or https, before creating a view', () => {
    const { pane, created } = setup();
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'app://melinna/index.html', '', 42]) {
      expect(() => pane.open(url, BOUNDS)).toThrow(expect.objectContaining({ code: 'INPUT_INVALID' }));
    }
    expect(created).toEqual([]);
  });

  it('blocks navigations and redirects to other schemes', () => {
    const { pane, fake, log } = setup();
    pane.open('https://example.com/', BOUNDS);
    expect(navigation(fake, 'will-navigate', 'https://example.com/outra')).toBe(false);
    expect(navigation(fake, 'will-navigate', 'file:///C:/Windows/win.ini')).toBe(true);
    expect(navigation(fake, 'will-redirect', 'app://melinna/index.html')).toBe(true);
    expect(log.events().filter((e) => e === 'browser.navigation_blocked')).toHaveLength(2);
    expect(log.text()).not.toContain('win.ini');
  });

  it('never opens another window: a web link loads in the same view', () => {
    const { pane, fake } = setup();
    pane.open('https://example.com/', BOUNDS);
    expect(fake.open('https://example.com/nova')).toEqual({ action: 'deny' });
    expect(fake.s.loads.at(-1)).toBe('https://example.com/nova');
    expect(fake.open('file:///etc/passwd')).toEqual({ action: 'deny' });
    expect(fake.s.loads).toHaveLength(2);
  });

  it('denies every permission and cancels downloads', () => {
    const { pane, fake } = setup();
    pane.open('https://example.com/', BOUNDS);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      expect(fake.askPermission(p)).toBe(false);
    }
    expect(fake.download()).toBe(true);
  });

  it('publishes the state on navigation events', () => {
    const { pane, fake, states } = setup();
    pane.open('https://example.com/', BOUNDS);
    fake.s.title = 'Exemplo';
    fake.s.back = true;
    fake.fire('did-navigate');
    expect(states.at(-1)).toEqual({
      open: true,
      url: 'https://example.com/',
      title: 'Exemplo',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      error: null,
    });
    fake.s.loading = true;
    fake.fire('did-start-loading');
    expect(states.at(-1)?.loading).toBe(true);
  });

  it('reports a failed load of the main frame and clears it on the next navigation', () => {
    const { pane, fake, states } = setup();
    fake.s.failLoad = true;
    pane.open('http://localhost:9', BOUNDS);
    fake.fire('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:9/', true);
    expect(states.at(-1)?.error).toBe('ERR_CONNECTION_REFUSED');
    const before = states.length;
    fake.fire('did-fail-load', {}, -3, 'ERR_ABORTED', 'http://localhost:9/', true);
    fake.fire('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://ads.example/', false);
    expect(states).toHaveLength(before);
    fake.fire('did-navigate');
    expect(states.at(-1)?.error).toBeNull();
  });

  it('goes back and forward only when there is history', () => {
    const { pane, fake } = setup();
    pane.open('https://example.com/', BOUNDS);
    pane.back();
    pane.forward();
    expect([fake.s.wentBack, fake.s.wentForward]).toEqual([0, 0]);
    fake.s.back = true;
    fake.s.forward = true;
    pane.back();
    pane.forward();
    pane.reload();
    pane.stop();
    expect([fake.s.wentBack, fake.s.wentForward, fake.s.reloads, fake.s.stops]).toEqual([1, 1, 1, 1]);
  });

  it('closes the page, frees it and reports the closed state; closing again is a no-op', () => {
    const { pane, fake, detached, states } = setup();
    pane.open('https://example.com/', BOUNDS);
    pane.close();
    expect(detached).toEqual([fake.view]);
    expect(fake.s.closed).toBe(true);
    expect(states.at(-1)).toMatchObject({ open: false, url: '' });
    expect(pane.state().open).toBe(false);
    const count = states.length;
    pane.close();
    fake.fire('did-navigate');
    expect(states).toHaveLength(count);
    expect(detached).toHaveLength(1);
  });

  it('ignores commands while no page is open', () => {
    const { pane, created } = setup();
    pane.navigate('https://example.com/');
    pane.back();
    pane.reload();
    pane.setBounds(BOUNDS);
    expect(created).toEqual([]);
    expect(pane.state().open).toBe(false);
  });
});
