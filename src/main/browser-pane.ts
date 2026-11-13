import type { Logger } from '../core/ports/logger';
import { BROWSER_CLOSED, type BrowserBounds, type BrowserState } from '../shared/browser-types';
import { validateExternalUrl } from './open-external';

/** Sessão própria do navegador embutido: cookies e cache separados dos da janela do app. */
export const BROWSER_PARTITION = 'persist:melinna-browser';

/** Código do Chromium para carga interrompida por outra navegação; não é falha. */
const ERR_ABORTED = -3;

export interface BrowserViewOptions {
  webPreferences: {
    partition: string;
    sandbox: boolean;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    webSecurity: boolean;
  };
}

type NavigationEvent = { preventDefault(): void };

export interface BrowserContentsLike {
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  reload(): void;
  stop(): void;
  close(): void;
  navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
  on(event: 'will-navigate' | 'will-redirect', fn: (e: NavigationEvent, url: string) => void): void;
  on(
    event:
      | 'did-start-loading'
      | 'did-stop-loading'
      | 'did-navigate'
      | 'did-navigate-in-page'
      | 'page-title-updated',
    fn: () => void,
  ): void;
  on(
    event: 'did-fail-load',
    fn: (e: unknown, code: number, description: string, url: string, isMainFrame: boolean) => void,
  ): void;
  setWindowOpenHandler(fn: (details: { url: string }) => { action: 'deny' }): void;
  session: {
    setPermissionRequestHandler(
      fn: (contents: unknown, permission: string, callback: (granted: boolean) => void) => void,
    ): void;
    on(event: 'will-download', fn: (e: NavigationEvent) => void): void;
  };
}

export interface BrowserViewLike {
  webContents: BrowserContentsLike;
  setBounds(bounds: BrowserBounds): void;
}

export interface BrowserPaneDeps<V extends BrowserViewLike> {
  create: (opts: BrowserViewOptions) => V;
  /** Põe a página por cima do conteúdo da janela do app. */
  attach: (view: V) => void;
  detach: (view: V) => void;
  emit: (state: BrowserState) => void;
  log: Logger;
}

export function browserViewOptions(): BrowserViewOptions {
  return {
    webPreferences: {
      partition: BROWSER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  };
}

function isWebUrl(url: string): boolean {
  try {
    validateExternalUrl(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Navegador embutido: uma página web numa vista isolada da janela do app. Sem preload, em sessão própria,
 * só http e https, sem janelas novas, sem downloads e sem permissões (câmera, microfone, localização…).
 */
export class BrowserPane<V extends BrowserViewLike> {
  private view: V | null = null;
  private error: string | null = null;

  constructor(private readonly deps: BrowserPaneDeps<V>) {}

  state(): BrowserState {
    const wc = this.view?.webContents;
    if (!wc) return BROWSER_CLOSED;
    return {
      open: true,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: this.error,
    };
  }

  /** Abre a página no retângulo dado; se já há uma aberta, navega nela. */
  open(rawUrl: unknown, bounds: BrowserBounds): void {
    const url = validateExternalUrl(rawUrl);
    const view = this.view ?? this.createView();
    view.setBounds(bounds);
    this.load(view, url);
  }

  navigate(rawUrl: unknown): void {
    const url = validateExternalUrl(rawUrl);
    if (this.view) this.load(this.view, url);
  }

  back(): void {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  forward(): void {
    const history = this.view?.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  reload(): void {
    this.error = null;
    this.view?.webContents.reload();
  }

  stop(): void {
    this.view?.webContents.stop();
  }

  setBounds(bounds: BrowserBounds): void {
    this.view?.setBounds(bounds);
  }

  /** Fecha a página e libera o processo dela; chamar de novo não faz nada. */
  close(): void {
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.error = null;
    this.deps.detach(view);
    view.webContents.close();
    this.deps.emit(BROWSER_CLOSED);
  }

  private load(view: V, url: string): void {
    this.error = null;
    view.webContents.loadURL(url).catch((err: unknown) => {
      // A falha de carga já chega por `did-fail-load`; aqui fica só o registro.
      this.deps.log.debug('browser.load_rejected', { reason: err instanceof Error ? err.message : '' });
    });
  }

  private createView(): V {
    const view = this.deps.create(browserViewOptions());
    const wc = view.webContents;
    const publish = () => {
      if (this.view === view) this.deps.emit(this.state());
    };
    const guard = (e: NavigationEvent, url: string) => {
      if (isWebUrl(url)) return;
      e.preventDefault();
      this.deps.log.warn('browser.navigation_blocked', { scheme: url.split(':')[0] ?? '' });
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url }) => {
      // Link que abriria outra janela navega na mesma página.
      if (isWebUrl(url) && this.view === view) this.load(view, url);
      return { action: 'deny' };
    });
    wc.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    wc.session.on('will-download', (e) => e.preventDefault());
    wc.on('did-start-loading', publish);
    wc.on('did-stop-loading', publish);
    wc.on('did-navigate', () => {
      this.error = null;
      publish();
    });
    wc.on('did-navigate-in-page', publish);
    wc.on('page-title-updated', publish);
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      this.error = description || `erro ${code}`;
      publish();
    });
    this.view = view;
    this.deps.attach(view);
    return view;
  }
}
