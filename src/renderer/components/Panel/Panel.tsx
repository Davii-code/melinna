import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentDefinition, Execution } from '../../../shared/ipc-contract';
import { TerminalView, type TerminalHandle } from '../TerminalView';
import { PanelHeader } from './PanelHeader';
import { isSearchShortcut, TerminalSearch } from './TerminalSearch';

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
  baseAdvancedBy?: number;
}

export function Panel(p: PanelProps) {
  const handle = useRef<TerminalHandle | null>(null);
  const [searching, setSearching] = useState(false);

  // Ctrl+Shift+F abre a busca do painel; a captura impede que o atalho chegue ao PTY.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLElement>) => {
    if (!isSearchShortcut(e) || !handle.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSearching(true);
  };

  return (
    <section
      className={`panel${p.focused ? ' focused' : ''}`}
      data-testid={`panel-${p.execution.id}`}
      onMouseDown={p.onFocus}
      onKeyDownCapture={onKeyDownCapture}
      aria-label={`Painel ${p.agent?.displayName ?? p.execution.agentId}`}
    >
      <PanelHeader
        execution={p.execution}
        agent={p.agent}
        actions={p.actions}
        onClose={p.onClose}
        draggable={Boolean(p.onHeaderDragStart)}
        baseAdvancedBy={p.baseAdvancedBy ?? 0}
        {...(p.onHeaderDragStart ? { onDragStart: p.onHeaderDragStart } : {})}
      >
        {p.headerExtras}
      </PanelHeader>
      {p.banner}
      <div className="panel-body">
        <TerminalView
          execId={p.execution.id}
          visible={p.visible}
          onReady={(h) => {
            handle.current = h;
            p.onTerminalReady?.(h);
          }}
        />
        {searching && handle.current && (
          <TerminalSearch terminal={handle.current.term} onClose={() => setSearching(false)} />
        )}
        {p.overlay}
      </div>
    </section>
  );
}
