import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { AgentDefinition, Execution } from '../../../shared/ipc-contract';
import { TerminalView, type TerminalHandle } from '../TerminalView';
import { isSearchShortcut, TerminalSearch } from './TerminalSearch';

export interface PanelProps {
  execution: Execution;
  agent: AgentDefinition | undefined;
  visible: boolean;
  focused: boolean;
  onFocus: () => void;
  banner?: ReactNode;
  overlay?: ReactNode;
  onTerminalReady?: (h: TerminalHandle | null) => void;
}

/**
 * Painel de uma execução: só o terminal, sem cabeçalho. Agente, estado, modelo, modo e fechar ficam na
 * linha da execução na árvore.
 */
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
