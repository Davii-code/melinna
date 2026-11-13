import { BROWSER_BOUNDS_MAX, type BrowserBounds } from '../../shared/browser-types';
import { invalid, isObj } from './validate-common';

function side(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > BROWSER_BOUNDS_MAX) throw invalid(what);
  return v;
}

function bounds(v: unknown): BrowserBounds {
  if (!isObj(v)) throw invalid('área do navegador');
  return {
    x: side(v.x, 'área do navegador'),
    y: side(v.y, 'área do navegador'),
    width: side(v.width, 'área do navegador'),
    height: side(v.height, 'área do navegador'),
  };
}

/** O endereço é validado pelo painel (`validateExternalUrl`): só http e https. */
export function parseBrowserOpen(args: unknown[]): [unknown, BrowserBounds] {
  return [args[0], bounds(args[1])];
}

export function parseBrowserUrl(args: unknown[]): [unknown] {
  return [args[0]];
}

export function parseBrowserBounds(args: unknown[]): [BrowserBounds] {
  return [bounds(args[0])];
}
