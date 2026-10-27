import type { ReactNode } from 'react';
import type { SidebarPanel } from '../../prefs';

export interface ToolStripProps {
  panel: SidebarPanel;
  /** Barra lateral recolhida: nenhum painel aparece como ativo. */
  collapsed: boolean;
  /** Arquivos alterados no workspace ativo; vira o selo do ícone Commit. */
  changes: number;
  onSelect: (panel: SidebarPanel) => void;
  onPrompts: () => void;
  onCatalog: () => void;
  /** Dica do ícone da biblioteca de prompts (com o atalho do mapa atual). */
  promptsTitle?: string;
}

const BADGE_MAX = 99;

const svg = (children: ReactNode) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const ICONS = {
  workspaces: svg(
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
    </>,
  ),
  files: svg(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  commit: svg(
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M3 12h5.5M15.5 12H21" />
    </>,
  ),
  prompts: svg(
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </>,
  ),
  catalog: svg(
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>,
  ),
};

const PANELS: { id: SidebarPanel; label: string }[] = [
  { id: 'workspaces', label: 'Workspaces (Alt+1)' },
  { id: 'files', label: 'Arquivos (Alt+2)' },
  { id: 'commit', label: 'Commit (Alt+0)' },
];

/** Barra de ferramentas vertical: escolhe o painel lateral; embaixo, a biblioteca de prompts e o catálogo. */
export function ToolStrip({
  panel,
  collapsed,
  changes,
  onSelect,
  onPrompts,
  onCatalog,
  promptsTitle,
}: ToolStripProps) {
  return (
    <nav className="tool-strip" aria-label="Barra de ferramentas">
      <div className="tool-strip-top">
        {PANELS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="tool-strip-button"
            aria-label={p.label}
            title={p.label}
            aria-pressed={!collapsed && panel === p.id}
            onClick={() => onSelect(p.id)}
          >
            {ICONS[p.id]}
            <span className="tool-strip-label">
              {p.id === 'workspaces' ? 'Projetos' : p.id === 'files' ? 'Arquivos' : 'Git'}
            </span>
            {p.id === 'commit' && changes > 0 && (
              <span className="tool-strip-badge" data-testid="commit-badge">
                {changes > BADGE_MAX ? `${BADGE_MAX}+` : changes}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="tool-strip-bottom">
        <button
          type="button"
          className="tool-strip-button"
          aria-label="Biblioteca de prompts"
          title={promptsTitle ?? 'Biblioteca de prompts'}
          onClick={onPrompts}
        >
          {ICONS.prompts}
          <span className="tool-strip-label">Prompts</span>
        </button>
        <button
          type="button"
          className="tool-strip-button"
          aria-label="Catálogo de agentes"
          title="Catálogo de agentes"
          onClick={onCatalog}
        >
          {ICONS.catalog}
          <span className="tool-strip-label">Agentes</span>
        </button>
      </div>
    </nav>
  );
}
