import { MelinnaError } from '../core/errors';
import { object, toolString, ideInvalid, type HttpInput, type HttpOutput } from '../shared/ide-types';

interface HistoryEntry {
  origin: string;
  method: string;
  status: number;
  durationMs: number;
}
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const MAX_BODY = 2 * 1024 * 1024;
function webUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return ideInvalid('URL inválida.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    return ideInvalid('Use HTTP ou HTTPS sem credenciais na URL.');
  return url;
}
export class NodeHttpClient {
  private disposed = false;
  private readonly active = new Map<string, AbortController>();
  private readonly entries: HistoryEntry[] = [];
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  history(): readonly HistoryEntry[] {
    return [...this.entries];
  }
  cancel(id: string): void {
    this.active.get(id)?.abort();
  }
  close(): void {
    this.disposed = true;
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }
  async send(raw: HttpInput): Promise<HttpOutput> {
    if (this.disposed) return ideInvalid('As requisições foram encerradas.');
    const v = object(raw);
    const id = toolString(v.id, 64);
    const method = toolString(v.method, 16);
    if (!METHODS.has(method) || this.active.has(id) || this.active.size >= 4)
      return ideInvalid('Método inválido ou requisição já em andamento.');
    let url = webUrl(toolString(v.url));
    const headers = object(v.headers);
    if (Object.keys(headers).length > 64 || JSON.stringify(headers).length > 32768) return ideInvalid();
    const safeHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers))
      safeHeaders[toolString(name, 256)] = toolString(value, 8192);
    if (typeof v.body !== 'string' || new TextEncoder().encode(v.body).length > 1024 * 1024)
      return ideInvalid();
    const controller = new AbortController();
    this.active.set(id, controller);
    const started = Date.now();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    let currentMethod = method;
    let body = v.body;
    try {
      let response: Response | null = null;
      for (let redirect = 0; redirect <= 5; redirect++) {
        response = await this.fetcher(url, {
          method: currentMethod,
          headers: safeHeaders,
          ...(currentMethod !== 'GET' && currentMethod !== 'HEAD' ? { body } : {}),
          signal: controller.signal,
          redirect: 'manual',
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location) break;
        await response.body?.cancel();
        const next = webUrl(new URL(location, url).href);
        if (redirect === 5 || next.origin !== url.origin)
          return ideInvalid(
            'Redirecionamento para outra origem ou acima do limite. Abra a URL de destino explicitamente.',
          );
        if (response.status === 303 || ([301, 302].includes(response.status) && currentMethod === 'POST')) {
          currentMethod = 'GET';
          body = '';
        }
        url = next;
      }
      if (!response) throw new Error('missing response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      let truncated = false;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            const keep = chunk.value.subarray(0, MAX_BODY - size);
            chunks.push(keep);
            size += keep.length;
            if (keep.length < chunk.value.length) {
              truncated = true;
              await reader.cancel();
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const contentType = response.headers.get('content-type') ?? '';
      const binary = Boolean(
        contentType && !/text|json|xml|javascript|x-www-form-urlencoded/i.test(contentType),
      );
      const durationMs = Date.now() - started;
      this.entries.push({ origin: url.origin, method, status: response.status, durationMs });
      if (this.entries.length > 20) this.entries.shift();
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: binary ? `Resposta binária (${size} bytes).` : new TextDecoder().decode(bytes),
        durationMs,
        binary,
        truncated,
      };
    } catch (error) {
      if (error instanceof MelinnaError) throw error;
      throw new MelinnaError('IO_ERROR', {
        userMessage: controller.signal.aborted
          ? timedOut
            ? 'A requisição excedeu 30 segundos.'
            : 'Requisição cancelada.'
          : 'Não foi possível concluir a requisição HTTP.',
      });
    } finally {
      clearTimeout(timeout);
      this.active.delete(id);
    }
  }
}
