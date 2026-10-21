import type { AgentDefinition, Execution } from '../../../shared/ipc-contract';

export interface ExecutionTabsProps {
  /** Execuções do painel, na ordem das abas. */
  execs: readonly Execution[];
  activeIndex: number;
  agentOf: (agentId: string) => AgentDefinition | undefined;
  onSelect(index: number): void;
  onCloseTab(index: number): void;
}

/** Faixa de abas de um painel com mais de uma execução; uma aba por PTY. */
export function ExecutionTabs({ execs, activeIndex, agentOf, onSelect, onCloseTab }: ExecutionTabsProps) {
  return (
    <div className="exec-tabs" role="tablist" aria-label="Execuções do painel">
      {execs.map((exec, index) => {
        const active = index === activeIndex;
        const name = agentOf(exec.agentId)?.displayName ?? exec.agentId;
        return (
          <div key={exec.id} className={`exec-tab${active ? ' active' : ''}`}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="exec-tab-name"
              onClick={() => onSelect(index)}
              title={`${name} · ${exec.status}`}
            >
              <span className={`exec-tab-dot status-${exec.status}`} aria-hidden="true" />
              {name}
            </button>
            <button
              type="button"
              className="exec-tab-close"
              aria-label={`Fechar aba ${name}`}
              title="Fechar aba (o PTY continua vivo)"
              onClick={() => onCloseTab(index)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
