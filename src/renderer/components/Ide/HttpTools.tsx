import { useEffect, useRef, useState } from 'react';
import { useApi, unwrap } from '../../api';
import type { HttpOutput } from '../../../shared/ide-types';
import { toolError } from './ToolLaunch';

export function HttpTools() {
  const api = useApi();
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [headers, setHeaders] = useState('{}');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<HttpOutput | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [history, setHistory] = useState<
    { origin: string; method: string; status: number; durationMs: number }[]
  >([]);
  const active = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (active.current) void api.ide.httpCancel(active.current);
    };
  }, [api]);
  return (
    <div>
      <form
        className="ide-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending) return;
          setError('');
          setResponse(null);
          const id = crypto.randomUUID();
          setPending(id);
          active.current = id;
          void (async () => {
            try {
              const parsed: unknown = JSON.parse(headers);
              if (
                !parsed ||
                Array.isArray(parsed) ||
                typeof parsed !== 'object' ||
                !Object.values(parsed).every((v) => typeof v === 'string')
              )
                throw new Error('Headers devem ser um objeto JSON com valores de texto.');
              const result = await unwrap(
                api.ide.httpSend({ id, url, method, headers: parsed as Record<string, string>, body }),
              );
              if (!alive.current) return;
              setResponse(result);
              setHistory((old) =>
                [
                  {
                    origin: new URL(url).origin,
                    method,
                    status: result.status,
                    durationMs: result.durationMs,
                  },
                  ...old,
                ].slice(0, 20),
              );
            } catch (error) {
              if (alive.current) setError(toolError(error));
            } finally {
              active.current = null;
              if (alive.current) setPending(null);
            }
          })();
        }}
      >
        <div className="ide-row">
          <label>
            Método
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            URL
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </label>
        </div>
        <label>
          Headers JSON
          <textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={2} />
        </label>
        <label>
          Corpo da requisição
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            disabled={method === 'GET' || method === 'HEAD'}
          />
        </label>
        <div className="ide-row">
          <button disabled={!!pending}>Enviar requisição</button>
          <button
            type="button"
            disabled={!pending}
            onClick={() => {
              if (pending) void api.ide.httpCancel(pending);
            }}
          >
            Cancelar requisição
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="ide-error">
          {error}
        </p>
      )}
      {response && (
        <section aria-label="Resposta HTTP">
          <p className="ide-status">
            HTTP {response.status} · {response.durationMs} ms
            {response.truncated ? ' · resposta truncada em 2 MiB' : ''}
          </p>
          <details>
            <summary>Headers da resposta</summary>
            <pre>{JSON.stringify(response.headers, null, 2)}</pre>
          </details>
          <pre className="ide-preview">{response.body}</pre>
        </section>
      )}
      {history.length > 0 && (
        <details>
          <summary>Histórico desta sessão</summary>
          <ul>
            {history.map((r, i) => (
              <li key={i}>
                {r.method} {r.origin} — {r.status} · {r.durationMs} ms
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
