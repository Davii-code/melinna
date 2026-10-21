import type { AgentDefinition, CatalogIssue, DetectResult } from '../../shared/ipc-contract';

export interface CatalogViewProps {
  agents: readonly AgentDefinition[];
  detect: Readonly<Record<string, DetectResult>>;
  invalid: readonly CatalogIssue[];
  onClose: () => void;
  onReload: () => void;
}

const SOURCE: Record<CatalogIssue['source'], string> = {
  builtin: 'catálogo embutido',
  user: 'catálogo do usuário',
};

function InstallState({ agent, detect }: { agent: AgentDefinition; detect: DetectResult | undefined }) {
  if (!detect) return <span className="meta">não verificado</span>;
  if (detect.installed) {
    return <span className="installed">instalado em {detect.resolvedPath ?? detect.searched}</span>;
  }
  return (
    <span className="not-found">
      não encontrado — procurado: {detect.searched || agent.executable.command}
      {detect.reason ? ` (${detect.reason})` : ''}
    </span>
  );
}

/** Tela do catálogo: agentes e shells com o estado de instalação, e entradas inválidas com o motivo. */
export function CatalogView({ agents, detect, invalid, onClose, onReload }: CatalogViewProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal catalog-view" role="dialog" aria-modal="true" aria-labelledby="catalog-title">
        <h2 id="catalog-title">Catálogo de agentes</h2>
        <table className="catalog-table">
          <thead>
            <tr>
              <th>Agente</th>
              <th>Tipo</th>
              <th>Instalação</th>
              <th>Versão conferida</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} data-testid={`catalog-${a.id}`}>
                <td>
                  <span className="agent-name">{a.displayName}</span> <code>{a.id}</code>
                </td>
                <td>{a.kind === 'shell' ? 'shell' : 'agente'}</td>
                <td>
                  <InstallState agent={a} detect={detect[a.id]} />
                </td>
                <td>{a.verifiedWith ? <span>conferido com {a.verifiedWith}</span> : <span className="meta">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Entradas inválidas</h3>
        {invalid.length === 0 ? (
          <p className="meta">Todas as entradas do catálogo são válidas.</p>
        ) : (
          <ul className="catalog-invalid" aria-label="Entradas inválidas">
            {invalid.map((i, n) => (
              <li key={`${i.source}-${i.id ?? n}`}>
                {i.id && <code>{i.id}</code>} <span className="meta">{SOURCE[i.source]}</span>: {i.reason}
              </li>
            ))}
          </ul>
        )}
        <div className="actions">
          <button type="button" onClick={onReload}>
            Recarregar
          </button>
          <button type="button" className="primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
