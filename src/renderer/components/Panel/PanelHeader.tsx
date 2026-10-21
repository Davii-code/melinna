import type { ReactNode } from 'react';
import type { AgentDefinition, Execution } from '../../../shared/ipc-contract';
import { statusLabel } from '../../labels';
import { bandColor, bandLabel } from '../../theme/bands';
import { DivergenceBadge } from '../DivergenceBadge';

export interface PanelHeaderProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
  /** Seletores e selos do painel (modelo, permissão, divergência). */
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** Commits que a base avançou desde a criação do worktree. */
  baseAdvancedBy?: number;
}

export function permissionLabel(agent: AgentDefinition | undefined, mode: string | null): string | null {
  if (!mode) return null;
  return agent?.permission?.options.find((o) => o.id === mode)?.label ?? mode;
}

export function modelLabel(agent: AgentDefinition | undefined, model: string | null): string | null {
  if (!model) return null;
  return agent?.model?.options.find((o) => o.id === model)?.label ?? model;
}

/** Cabeçalho fino: faixa colorida, número a partir da 7ª execução, agente, modelo, modo e estado. */
export function PanelHeader({
  execution,
  agent,
  children,
  actions,
  onClose,
  draggable,
  onDragStart,
  baseAdvancedBy = 0,
}: PanelHeaderProps) {
  const color = bandColor(execution.bandIndex);
  const number = bandLabel(execution.bandIndex);
  const model = modelLabel(agent, execution.model);
  const mode = permissionLabel(agent, execution.permissionMode);
  return (
    <header
      className="panel-header"
      draggable={draggable}
      onDragStart={onDragStart}
      data-testid="panel-header"
    >
      <span className="band" style={{ background: color }} aria-hidden="true" />
      {number && (
        <span className="band-number" style={{ color }} data-testid="band-number">
          {number}
        </span>
      )}
      <span className="agent-name">{agent?.displayName ?? execution.agentId}</span>
      {model && !children && (
        <span className="meta" data-testid="panel-model">
          {model}
        </span>
      )}
      {mode && !children && (
        <span className="meta" data-testid="panel-mode">
          {mode}
        </span>
      )}
      {children}
      <DivergenceBadge count={baseAdvancedBy} />
      <span className={`status status-${execution.status}`} data-testid="panel-status">
        {statusLabel(execution)}
      </span>
      <span className="spacer" />
      {actions}
      <button
        type="button"
        className="icon-button"
        title="Fechar painel (o processo continua)"
        aria-label="Fechar painel"
        onClick={onClose}
      >
        ×
      </button>
    </header>
  );
}
