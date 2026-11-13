import { useEffect, useRef, useState } from 'react';
import { useApi, unwrap } from '../../api';
import type { QueryOutput } from '../../../shared/ide-types';
import { toolError } from './ToolLaunch';

export function DatabaseTools() {
  const api = useApi();
  const [path, setPath] = useState('');
  const [id, setId] = useState<string | null>(null);
  const [sql, setSql] = useState('SELECT name, type, sql FROM sqlite_schema ORDER BY name');
  const [result, setResult] = useState<QueryOutput | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current.current) void api.ide.dbClose(current.current);
    };
  }, [api]);
  const query = async (connection: string, text: string) => {
    const data = await unwrap(api.ide.dbQuery(connection, text));
    if (alive.current) setResult(data);
  };
  return (
    <div>
      <p className="ide-status">
        SQLite somente leitura · arquivo dentro de uma pasta aberta · até 500 linhas · limite de 10 segundos
      </p>
      <form
        className="ide-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || id) return;
          setBusy(true);
          setError('');
          void (async () => {
            try {
              const connection = await unwrap(api.ide.dbOpen(path));
              if (!alive.current) {
                void api.ide.dbClose(connection);
                return;
              }
              current.current = connection;
              setId(connection);
              await query(connection, 'SELECT name, type, sql FROM sqlite_schema ORDER BY name');
            } catch (error) {
              if (alive.current) setError(toolError(error));
            } finally {
              if (alive.current) setBusy(false);
            }
          })();
        }}
      >
        <label>
          Arquivo SQLite
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            disabled={!!id || busy}
            placeholder="Caminho completo do banco"
          />
        </label>
        <div className="ide-row">
          <button disabled={!!id || busy}>Abrir somente leitura</button>
          <button
            type="button"
            disabled={!id}
            onClick={() => {
              if (id) void api.ide.dbClose(id);
              current.current = null;
              setId(null);
              setResult(null);
            }}
          >
            Fechar conexão
          </button>
        </div>
      </form>
      <form
        className="ide-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!id || busy) return;
          setBusy(true);
          setError('');
          void query(id, sql)
            .catch((error: unknown) => {
              if (alive.current) setError(toolError(error));
            })
            .finally(() => {
              if (alive.current) setBusy(false);
            });
        }}
      >
        <label>
          Consulta SQL
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} rows={4} maxLength={65536} />
        </label>
        <button disabled={!id || busy}>Executar consulta</button>
      </form>
      {error && (
        <p role="alert" className="ide-error">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="ide-status">
            {result.rows.length} linha(s){result.truncated ? ' · resultado truncado' : ''}
          </p>
          <div className="ide-results">
            <table className="ide-table">
              <thead>
                <tr>
                  {result.columns.map((column, i) => (
                    <th key={i} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td key={j}>{value === null ? 'NULL' : String(value)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
