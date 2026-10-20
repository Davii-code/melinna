import type { ReactNode } from 'react';
import wordmark from '../../../docs/brand/logo-wordmark.svg?url';

export interface TopBarProps {
  onNewTask: () => void;
  freeSlots: number;
  children?: ReactNode;
}

/** Barra superior: wordmark, seletor de layout e botão de nova tarefa. */
export function TopBar({ onNewTask, freeSlots, children }: TopBarProps) {
  return (
    <header className="topbar">
      <img className="wordmark" src={wordmark} alt="melinna" height={22} />
      <span className="tagline">Um feixe entra. Seis saem.</span>
      <span className="spacer" />
      {children}
      <span className="slots" title="Vagas para execuções vivas" data-testid="free-slots">
        {freeSlots} vaga{freeSlots === 1 ? '' : 's'}
      </span>
      <button type="button" className="primary" onClick={onNewTask} disabled={freeSlots === 0}>
        Nova tarefa
      </button>
    </header>
  );
}
