import { extname, join, normalize, relative, sep } from 'node:path';
import { CONTENT_SECURITY_POLICY } from './window';

export const APP_SCHEME = 'app';
export const APP_HOST = 'melinna';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/** Resolve a URL `app://melinna/<caminho>` para um arquivo dentro de `root`; fora disso, `null`. */
export function resolveAppFile(root: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.host !== APP_HOST) return null;
  const pathname = decodeURIComponent(parsed.pathname);
  const rel = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('\0')) return null;
  const file = normalize(join(root, rel));
  const back = relative(root, file);
  if (back.startsWith('..') || back.startsWith(sep) || back === '') return null;
  return file;
}

export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export interface ProtocolDeps {
  handle(scheme: string, fn: (req: { url: string }) => Promise<Response>): void;
  readFile(path: string): Promise<Uint8Array>;
  root: string;
}

/** Serve os arquivos da interface pelo esquema `app://`, com CSP no cabeçalho. */
export function serveApp(deps: ProtocolDeps): void {
  deps.handle(APP_SCHEME, async (req) => {
    const file = resolveAppFile(deps.root, req.url);
    if (!file) return new Response('não encontrado', { status: 404 });
    try {
      const body = await deps.readFile(file);
      return new Response(body as unknown as ConstructorParameters<typeof Response>[0], {
        status: 200,
        headers: { 'Content-Type': mimeOf(file), 'Content-Security-Policy': CONTENT_SECURITY_POLICY },
      });
    } catch {
      return new Response('não encontrado', { status: 404 });
    }
  });
}
