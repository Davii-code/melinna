import { useEffect, useRef, useState } from 'react';
import type { AgentDefinition } from '../../../shared/ipc-contract';

export interface AgentMenuProps {
  /** Rótulo acessível do botão "+", por exemplo "Novo terminal na sessão Login". */
  label: string;
  agents: readonly AgentDefinition[];
  disabled?: boolean;
  onPick: (agentId: string) => void;
}

/** Botão "+" que abre a lista de IAs instaladas; escolher uma abre um terminal com ela. */
export function AgentMenu({ label, agents, disabled = false, onPick }: AgentMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="agent-menu" ref={root}>
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={agents.length === 0 ? 'Nenhuma IA instalada' : label}
        disabled={disabled || agents.length === 0}
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      {open && (
        <ul className="agent-menu-list" role="menu" aria-label={label}>
          {agents.map((a) => (
            <li key={a.id} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onPick(a.id);
                }}
              >
                {a.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
