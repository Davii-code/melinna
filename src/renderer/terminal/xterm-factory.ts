import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { BANDS, THEME } from '../theme/bands';
import type { TerminalFactory, TerminalLike } from './xterm-types';

export const SCROLLBACK_LINES = 10_000;

const SEARCH_DECORATIONS = {
  matchBackground: '#4f8cff55',
  activeMatchBackground: '#4f8cffaa',
  matchOverviewRuler: '#4f8cff',
  activeMatchColorOverviewRuler: '#ffffff',
};

/** xterm.js com fit, unicode11, webgl (com troca para DOM na perda de contexto), web-links e busca. */
export const createXterm: TerminalFactory = ({ openLink }) => {
  const term = new Terminal({
    scrollback: SCROLLBACK_LINES,
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'SF Mono', Menlo, 'DejaVu Sans Mono', monospace",
    fontSize: 13,
    theme: {
      background: THEME.field,
      foreground: THEME.text,
      cursor: THEME.core,
      selectionBackground: '#4f8cff44',
      red: BANDS[0],
      yellow: BANDS[2],
      green: BANDS[3],
      blue: BANDS[4],
      magenta: BANDS[5],
    },
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon((_event, uri) => openLink(uri)));
  const fallbacks: (() => void)[] = [];
  let webgl: WebglAddon | null = null;

  const like: TerminalLike = {
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    open(el) {
      term.open(el);
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl?.dispose();
          webgl = null;
          for (const fn of fallbacks) fn();
        });
        term.loadAddon(webgl);
      } catch {
        webgl = null;
      }
    },
    write: (data, cb) => term.write(data, cb),
    onData: (fn) => term.onData(fn),
    onBinary: (fn) => term.onBinary(fn),
    focus: () => term.focus(),
    dispose: () => term.dispose(),
    proposeSize: () => fit.proposeDimensions() ?? null,
    fit: () => fit.fit(),
    onRendererFallback: (fn) => fallbacks.push(fn),
    search: (q, dir) =>
      dir === 'next'
        ? search.findNext(q, { decorations: SEARCH_DECORATIONS })
        : search.findPrevious(q, { decorations: SEARCH_DECORATIONS }),
    clearSearch: () => search.clearDecorations(),
  };
  return like;
};
