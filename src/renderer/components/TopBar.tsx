import { useContext, type ReactNode } from 'react';
import { KeymapContext } from '../keymap/keymap-store';
import { KEYMAP_LABEL } from '../keymap/keymaps';
import avatar from '../../../docs/brand/avatar.jpg?url';
import wordmark from '../../../docs/brand/logo-wordmark.svg?url';

export interface TopBarProps {
  onNewTask: () => void;
  freeSlots: number;
  /** Abre o mapa de atalhos; sem isto o botão não aparece. */
  onShortcuts?: () => void;
  /** Seletores do workspace ativo e da branch, logo depois da marca. */
  leading?: ReactNode;
  children?: ReactNode;
}

/** Barra superior: wordmark, workspace ativo e branch, execução e botão de nova tarefa. */
export function TopBar({ onNewTask, freeSlots, onShortcuts, leading, children }: TopBarProps) {
  const keymap = useContext(KeymapContext);
  return (
    <header className="topbar">
      <img className="brand-avatar" src={avatar} alt="" />
      <img className="wordmark" src={wordmark} alt="melinna" height={22} />
      <span className="tagline">Um feixe entra. Seis saem.</span>
      {leading}
      <span className="spacer" />
      {children}
      {onShortcuts && (
        <button type="button" title={`Mapa de atalhos: ${KEYMAP_LABEL[keymap]}`} onClick={onShortcuts}>
          Atalhos
        </button>
      )}
      <span className="slots" title="Vagas para execuções vivas" data-testid="free-slots">
        {freeSlots} vaga{freeSlots === 1 ? '' : 's'}
      </span>
      <button type="button" className="primary" onClick={onNewTask} disabled={freeSlots === 0}>
        Nova tarefa
      </button>
    </header>
  );
}
