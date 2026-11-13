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
  onBrowser: () => void;
  onAutomations: () => void;
  onChat: () => void;
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
  chat: svg(
    <>
      <path d="M5 5h14v10H10l-5 4z" />
      <path d="M9 9h6M9 12h3" />
    </>,
  ),
  automations: svg(
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2h6" />
    </>,
  ),
  browser: svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
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

/** Barra de ferramentas vertical: escolhe o painel lateral; embaixo, o navegador, a biblioteca de prompts e o catálogo. */
export function ToolStrip({
  panel,
  collapsed,
  changes,
  onSelect,
  onPrompts,
  onCatalog,
  onBrowser,
  onAutomations,
  onChat,
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
          aria-label="Chat"
          title="Chat com o agente, sem terminal"
          onClick={onChat}
        >
          {ICONS.chat}
          <span className="tool-strip-label">Chat</span>
        </button>
        <button
          type="button"
          className="tool-strip-button"
          aria-label="Navegador"
          title="Navegador"
          onClick={onBrowser}
        >
          {ICONS.browser}
          <span className="tool-strip-label">Web</span>
        </button>
        <button
          type="button"
          className="tool-strip-button"
          aria-label="Automações"
          title="Automações agendadas"
          onClick={onAutomations}
        >
          {ICONS.automations}
          <span className="tool-strip-label">Agenda</span>
        </button>
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
