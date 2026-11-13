/** Retângulo da página do navegador embutido, em pixels da janela do app. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Estado do navegador embutido, enviado à interface a cada mudança. */
export interface BrowserState {
  /** Há uma página aberta. */
  open: boolean;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Motivo da última falha de carga; `null` quando a página carregou. */
  error: string | null;
}

export const BROWSER_CLOSED: BrowserState = {
  open: false,
  url: '',
  title: '',
  loading: false,
  canGoBack: false,
  canGoForward: false,
  error: null,
};

/** Maior lado aceito para o retângulo da página. */
export const BROWSER_BOUNDS_MAX = 20_000;
