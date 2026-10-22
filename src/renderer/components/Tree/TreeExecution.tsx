import type { ReactNode } from 'react';
import type { AgentDefinition, Execution } from '../../../shared/ipc-contract';
import { isLiveStatus, modelLabel, statusLabel } from '../../labels';
import { bandColor, bandLabel } from '../../theme/bands';
import { DivergenceBadge } from '../DivergenceBadge';

export interface TreeExecutionProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
  open: boolean;
  baseAdvancedBy: number;
  /** Parada pedida e ainda em curso (Ctrl+C e, após o prazo, encerramento forçado). */
  stopping?: boolean;
  /** Botões extras da execução com painel aberto (diff, fechar painel), antes dos demais. */
  tools?: ReactNode;
  onOpen: (execId: string) => void;
  onStop: (execId: string) => void;
  onRelaunch: (execId: string) => void;
  onRemove: (execId: string) => void;
}

export function TreeExecution(p: TreeExecutionProps) {
  const e = p.execution;
  const name = p.agent?.displayName ?? e.agentId;
  const color = bandColor(e.bandIndex);
  const number = bandLabel(e.bandIndex);
  const model = modelLabel(p.agent, e.model);
  const live = isLiveStatus(e.status);
  const canStop = live && e.status !== 'preparing' && !p.stopping;
  return (
    <li
      role="treeitem"
      className="tree-exec"
      data-testid={`tree-exec-${e.id}`}
      aria-current={p.open ? 'true' : undefined}
    >
      <div className="tree-row tree-exec-row">
        <span className="band" style={{ background: color }} aria-hidden="true" />
        {number && (
          <span className="band-number" style={{ color }} data-testid="band-number">
            {number}
          </span>
        )}
        <span className="agent-name">{name}</span>
        {model && <span className="meta">{model}</span>}
        <span className={`status status-${e.status}`} data-testid={`tree-exec-status-${e.id}`}>
          {p.stopping && live ? 'parando…' : statusLabel(e)}
        </span>
        <DivergenceBadge count={p.baseAdvancedBy} />
        <span className="spacer" />
        <span className="tree-actions">
          {p.tools}
          <button
            type="button"
            className="icon-button"
            aria-label={p.open ? `Focar ${name}` : `Abrir ${name}`}
            title={p.open ? 'Focar o painel' : 'Abrir o painel'}
            onClick={() => p.onOpen(e.id)}
          >
            ▣
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Parar ${name}`}
            title="Parar o processo (o worktree fica)"
            disabled={!canStop}
            onClick={() => p.onStop(e.id)}
          >
            ■
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Relançar ${name}`}
            title="Relançar no mesmo lugar"
            disabled={live}
            onClick={() => p.onRelaunch(e.id)}
          >
            ↻
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remover ${name}`}
            title="Remover execução"
            disabled={live}
            onClick={() => p.onRemove(e.id)}
          >
            🗑
          </button>
        </span>
      </div>
    </li>
  );
}
