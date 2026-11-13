import type { Logger } from '../../core/ports/logger';
import { CHANNELS } from '../../shared/ipc-contract';
import type { BrowserPane, BrowserViewLike } from '../browser-pane';
import { handler, type Handle } from './result';
import { parseBrowserBounds, parseBrowserOpen, parseBrowserUrl } from './validate-browser';
import { noArgs } from './validate-common';

export type BrowserApi = Pick<
  BrowserPane<BrowserViewLike>,
  'open' | 'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'setBounds' | 'close'
>;

/** Canais do navegador embutido: abrir, navegar, histórico, posição na janela e fechar. */
export function registerBrowser(handle: Handle, deps: { browser: BrowserApi; log: Logger }): void {
  const { browser, log } = deps;
  const C = CHANNELS.browser;
  handle(
    C.open,
    handler(log, C.open, parseBrowserOpen, (url, bounds) => browser.open(url, bounds)),
  );
  handle(
    C.navigate,
    handler(log, C.navigate, parseBrowserUrl, (url) => browser.navigate(url)),
  );
  handle(
    C.back,
    handler(log, C.back, noArgs, () => browser.back()),
  );
  handle(
    C.forward,
    handler(log, C.forward, noArgs, () => browser.forward()),
  );
  handle(
    C.reload,
    handler(log, C.reload, noArgs, () => browser.reload()),
  );
  handle(
    C.stop,
    handler(log, C.stop, noArgs, () => browser.stop()),
  );
  handle(
    C.setBounds,
    handler(log, C.setBounds, parseBrowserBounds, (bounds) => browser.setBounds(bounds)),
  );
  handle(
    C.close,
    handler(log, C.close, noArgs, () => browser.close()),
  );
}
