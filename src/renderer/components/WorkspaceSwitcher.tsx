import { useEffect, useRef, useState } from 'react';
import type { Group } from '../../shared/ipc-contract';
import { useGitWorkspace } from '../git/git-workspace';
import { storeActiveWorkspace } from '../prefs';
import { bandColor } from '../theme/bands';

export interface WorkspaceSwitcherProps {
  groups: readonly Group[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

/** Iniciais do nome: duas palavras dão uma letra de cada; uma palavra dá as duas primeiras letras. */
export function initialsOf(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
  const [first, second] = words;
  if (!first) return '?';
  const letters = second ? `${first.charAt(0)}${second.charAt(0)}` : first.slice(0, 2);
  return letters.toUpperCase();
}

function Icon({ group }: { group: Group }) {
  const color = bandColor(group.colorIndex ?? 0);
  return (
    <span className="ws-icon" aria-hidden="true" data-band={color} style={{ background: color }}>
      {initialsOf(group.name)}
    </span>
  );
}

const BUSY_HINT = 'Aguarde o fim do commit ou do push para trocar de workspace';

/** Seletor do workspace ativo na barra superior; a escolha fica lembrada entre aberturas. */
export function WorkspaceSwitcher({ groups, activeId, onSelect }: WorkspaceSwitcherProps) {
  const { busy } = useGitWorkspace();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const active = groups.find((g) => g.id === activeId) ?? groups[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (!active) return null;

  return (
    <div className="ws-switcher" ref={root}>
      <button
        type="button"
        className="ws-trigger"
        aria-label={`Workspace ativo: ${active.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        title={busy ? BUSY_HINT : 'Trocar o workspace ativo'}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon group={active} />
        <span className="ws-name">{active.name}</span>
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && !busy && (
        <div role="menu" className="ws-menu" aria-label="Workspaces">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              role="menuitemradio"
              aria-checked={g.id === active.id}
              className="ws-item"
              onClick={() => {
                storeActiveWorkspace(g.id);
                onSelect(g.id);
                setOpen(false);
              }}
            >
              <Icon group={g} />
              <span>{g.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
