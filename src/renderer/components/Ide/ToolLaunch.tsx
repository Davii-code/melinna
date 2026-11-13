import { useEffect, useRef, useState } from 'react';
import { useApi, unwrap } from '../../api';
import type { FileRoot } from '../../../shared/ipc-contract';
import type { ToolProtocol } from '../../../shared/ide-types';

export interface ToolSession {
  id: string;
  root: string;
  capabilities: Record<string, unknown>;
}
export function toolError(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}
export function withinRoot(path: string, root: string): boolean {
  const normalize = (p: string) => {
    const value = p.replace(/\\/g, '/').replace(/\/$/, '');
    return /^[A-Za-z]:/.test(value) ? value.toLowerCase() : value;
  };
  const value = normalize(path),
    base = normalize(root);
  return value === base || value.startsWith(base + '/');
}
export function ToolLaunch({
  protocol,
  roots,
  onSession,
  onError,
}: {
  protocol: ToolProtocol;
  roots: readonly FileRoot[];
  onSession(session: ToolSession | null): void;
  onError(error: string): void;
}) {
  const api = useApi();
  const [selected, setSelected] = useState('');
  const root = roots.some((r) => r.path === selected && r.available !== false)
    ? selected
    : (roots.find((r) => r.available !== false)?.path ?? '');
  const [executable, setExecutable] = useState('');
  const [args, setArgs] = useState('[]');
  const [busy, setBusy] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const alive = useRef(true);
  const callbacks = useRef({ onSession, onError });
  callbacks.current = { onSession, onError };
  const label = protocol === 'lsp' ? 'servidor LSP' : 'adaptador DAP';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current.current) void api.ide.stop(current.current);
    };
  }, [api]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`melinna.ide.${protocol}.v1:${root}`) ?? 'null') as {
        executable?: unknown;
      } | null;
      setExecutable(typeof saved?.executable === 'string' ? saved.executable : '');
    } catch {
      setExecutable('');
    }
    if (current.current) {
      void api.ide.stop(current.current);
      current.current = null;
      setId(null);
      callbacks.current.onSession(null);
    }
  }, [root, protocol, api]);
  useEffect(
    () =>
      api.ide.onEvent((event) => {
        if (event.sessionId === current.current && event.message.kind === 'closed') {
          current.current = null;
          setId(null);
          callbacks.current.onSession(null);
          callbacks.current.onError(
            'A ferramenta foi encerrada ou enviou um protocolo inválido. Inicie-a novamente para reconectar.',
          );
        }
      }),
    [api],
  );
  return (
    <details className="ide-config" open={!id}>
      <summary>{id ? `${label} conectado` : `Configurar ${label}`}</summary>
      <form
        className="ide-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          onError('');
          void (async () => {
            try {
              const argv: unknown = JSON.parse(args);
              if (!Array.isArray(argv) || !argv.every((arg) => typeof arg === 'string'))
                throw new Error('Argumentos devem ser uma lista JSON de strings.');
              const session = await unwrap(api.ide.start({ protocol, root, executable, args: argv }));
              if (!alive.current) {
                void api.ide.stop(session.sessionId);
                return;
              }
              current.current = session.sessionId;
              setId(session.sessionId);
              onSession({ id: session.sessionId, root, capabilities: session.capabilities });
              try {
                localStorage.setItem(
                  `melinna.ide.${protocol}.v1:${root}`,
                  JSON.stringify({ version: 1, executable }),
                );
              } catch {
                /* A conexão funciona sem persistência disponível. */
              }
            } catch (error) {
              if (alive.current) onError(toolError(error));
            } finally {
              if (alive.current) setBusy(false);
            }
          })();
        }}
      >
        <label>
          Pasta da ferramenta
          <select value={root} disabled={busy || !!id} onChange={(event) => setSelected(event.target.value)}>
            {roots
              .filter((r) => r.available !== false)
              .map((r) => (
                <option key={r.path} value={r.path}>
                  {r.label} — {r.path}
                </option>
              ))}
          </select>
        </label>
        <label>
          Executável do {label}
          <input
            value={executable}
            onChange={(event) => setExecutable(event.target.value)}
            disabled={busy || !!id}
            placeholder="Caminho do executável nativo"
            required
          />
        </label>
        <label>
          Argumentos JSON
          <textarea
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            disabled={busy || !!id}
            rows={2}
          />
        </label>
        <p className="ide-status">
          Use uma ferramenta instalada por você. Para scripts, informe Node como executável e o arquivo nos
          argumentos. Configurações do projeto não são executadas automaticamente.
        </p>
        <div className="ide-row">
          <button type="submit" disabled={busy || !!id || !root || !executable}>
            Iniciar {label}
          </button>
          <button
            type="button"
            disabled={!id}
            onClick={() => {
              if (id) void api.ide.stop(id);
              current.current = null;
              setId(null);
              onSession(null);
            }}
          >
            Encerrar {label}
          </button>
        </div>
      </form>
    </details>
  );
}
