import { useEffect } from 'react';
import type { LayoutMode } from '../../shared/ipc-contract';

const MODES: { mode: LayoutMode; label: string; hint: string }[] = [
  { mode: 'auto', label: 'Automático', hint: 'Divide o espaço entre os painéis abertos' },
  { mode: 'spotlight', label: 'Spotlight', hint: 'Um painel em foco e os outros reduzidos (Ctrl+Alt+← →)' },
  { mode: 'sidebar', label: 'Sidebar', hint: 'Um painel principal e os demais numa coluna' },
  { mode: 'custom', label: 'Grade personalizada', hint: 'Arraste as divisórias para definir as proporções' },
];

export interface LayoutSwitcherProps {
  mode: LayoutMode;
  onChange: (mode: LayoutMode) => void;
  /** Próximo (1) ou anterior (-1) painel em foco. */
  onCycleFocus: (step: 1 | -1) => void;
}

/** Seletor dos quatro modos de layout; no Spotlight, Ctrl+Alt+→/← troca o painel em foco. */
export function LayoutSwitcher({ mode, onChange, onCycleFocus }: LayoutSwitcherProps) {
  useEffect(() => {
    if (mode !== 'spotlight') return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onCycleFocus(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onCycleFocus(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, onCycleFocus]);

  return (
    <div className="layout-switcher" role="group" aria-label="Layout">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          aria-pressed={mode === m.mode}
          title={m.hint}
          onClick={() => onChange(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
