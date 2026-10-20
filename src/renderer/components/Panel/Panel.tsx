import type { ReactNode } from 'react';
import type { AgentDefinition, Execution } from '../../../shared/ipc-contract';
import { TerminalView, type TerminalHandle } from '../TerminalView';
import { PanelHeader } from './PanelHeader';

export interface PanelProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
  visible: boolean;
  focused: boolean;
  onClose: () => void;
  onFocus: () => void;
  headerExtras?: ReactNode;
  actions?: ReactNode;
  banner?: ReactNode;
  overlay?: ReactNode;
  onTerminalReady?: (h: TerminalHandle | null) => void;
  onHeaderDragStart?: (e: React.DragEvent) => void;
}

export function Panel(p: PanelProps) {
  return (
    <section
      className={`panel${p.focused ? ' focused' : ''}`}
      data-testid={`panel-${p.execution.id}`}
      onMouseDown={p.onFocus}
      aria-label={`Painel ${p.agent?.displayName ?? p.execution.agentId}`}
    >
      <PanelHeader
        execution={p.execution}
        agent={p.agent}
        actions={p.actions}
        onClose={p.onClose}
        draggable={Boolean(p.onHeaderDragStart)}
        {...(p.onHeaderDragStart ? { onDragStart: p.onHeaderDragStart } : {})}
      >
        {p.headerExtras}
      </PanelHeader>
      {p.banner}
      <div className="panel-body">
        <TerminalView
          execId={p.execution.id}
          visible={p.visible}
          {...(p.onTerminalReady ? { onReady: p.onTerminalReady } : {})}
        />
        {p.overlay}
      </div>
    </section>
  );
}
