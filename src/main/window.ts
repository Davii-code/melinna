export const CONTENT_SECURITY_POLICY = "default-src 'self'; style-src 'self' 'unsafe-inline'";

/**
 * Política da janela. Em produção vale a constante acima; em desenvolvimento o servidor do Vite serve
 * a página e o React Refresh injeta um script inline (preâmbulo do HMR), então a origem do dev server
 * precisa ser aceita para scripts e para o websocket. Sem isso a página não executa e a janela fica
 * preta.
 */
export function contentSecurityPolicy(devOrigin?: string): string {
  if (!devOrigin) return CONTENT_SECURITY_POLICY;
  return [
    `default-src 'self' ${devOrigin}`,
    `script-src 'self' 'unsafe-inline' ${devOrigin}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${devOrigin} ws://localhost:* ws://127.0.0.1:*`,
    `img-src 'self' data: ${devOrigin}`,
  ].join('; ');
}

export interface WebContentsLike {
  getURL(): string;
  on(event: 'will-navigate', fn: (e: { preventDefault(): void }, url: string) => void): void;
  setWindowOpenHandler(fn: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
  session: {
    webRequest: {
      onHeadersReceived(
        fn: (
          details: { responseHeaders?: Record<string, string[]> },
          cb: (r: { responseHeaders: Record<string, string[]> }) => void,
        ) => void,
      ): void;
    };
  };
}

export interface BrowserWindowLike {
  webContents: WebContentsLike;
  once(event: 'ready-to-show', fn: () => void): void;
  show(): void;
  loadURL(url: string): Promise<void>;
}

export interface BrowserWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  show: boolean;
  backgroundColor: string;
  title: string;
  icon?: string;
  webPreferences: {
    preload: string;
    sandbox: boolean;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    webSecurity: boolean;
    spellcheck: boolean;
  };
}

export interface CreateWindowDeps<W extends BrowserWindowLike> {
  create: (opts: BrowserWindowOptions) => W;
  preloadPath: string;
  url: string;
  iconPath?: string;
  /** Origem do servidor de desenvolvimento; ausente no app empacotado. */
  devOrigin?: string;
}

export function windowOptions(preloadPath: string, iconPath?: string): BrowserWindowOptions {
  const opts: BrowserWindowOptions = {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#07080b',
    title: 'Melinna',
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  };
  if (iconPath) opts.icon = iconPath;
  return opts;
}

/** Janela principal endurecida: sandbox, isolamento de contexto, CSP restrita, sem navegação nem janelas novas. */
export function createMainWindow<W extends BrowserWindowLike>(deps: CreateWindowDeps<W>): W {
  const win = deps.create(windowOptions(deps.preloadPath, deps.iconPath));
  const wc = win.webContents;
  const policy = contentSecurityPolicy(deps.devOrigin);
  wc.session.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        'Content-Security-Policy': [policy],
      },
    });
  });
  wc.on('will-navigate', (e, url) => {
    if (url !== wc.getURL()) e.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.once('ready-to-show', () => win.show());
  void win.loadURL(deps.url);
  return win;
}
