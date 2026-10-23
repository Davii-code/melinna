import { useCallback, useEffect, useState } from 'react';
import type { DirectoryListing, FileChange, FileEntry, FileRoot } from '../../../shared/ipc-contract';
import { useApi } from '../../api';
import { statusForDir, statusForPath, statusLabel, statusLetter } from '../../files/decorations';

interface DirState {
  listing: DirectoryListing | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_DIR: DirState = { listing: null, loading: false, error: null };

export interface FileExplorerProps {
  /** Chamado quando o usuário fecha o explorador para voltar à árvore de workspaces. */
  onShowWorkspaces?: () => void;
  /** Abre o arquivo numa aba do painel de editor (clique simples na linha). */
  onOpenFile?: (path: string) => void;
}

/** Texto da raiz no seletor: a principal de um workspace de várias pastas leva ★; indisponível é avisada. */
export function rootOptionLabel(root: FileRoot): string {
  const base = root.kind === 'worktree' ? `⑂ ${root.label}` : root.label;
  const marked = root.primary ? `★ ${base}` : base;
  return root.available === false ? `${marked} (indisponível)` : marked;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Marca de estado do git na linha da árvore. */
function StatusBadge({ change }: { change: FileChange }) {
  return (
    <span
      className={`files-status ${change}`}
      title={statusLabel(change)}
      aria-label={statusLabel(change)}
    >
      {statusLetter(change)}
    </span>
  );
}

/** Explorador das raízes abertas no app (workspaces e worktrees); o clique num arquivo abre o editor. */
export function FileExplorer({ onShowWorkspaces, onOpenFile }: FileExplorerProps) {
  const api = useApi();
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<Record<string, FileChange>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    void api.files.roots().then((r) => {
      if (!alive) return;
      const list = r.ok ? r.value : [];
      setRoots(list);
      setRootPath((current) => {
        const usable = list.filter((root) => root.available !== false);
        if (current !== null && usable.some((root) => root.path === current)) return current;
        return usable[0]?.path ?? null;
      });
    });
    return () => {
      alive = false;
    };
  }, [api, reloadKey]);

  const loadDir = useCallback(
    (path: string) => {
      setDirs((current) => ({ ...current, [path]: { ...EMPTY_DIR, loading: true } }));
      void api.files.list(path).then((r) => {
        setDirs((current) => ({
          ...current,
          [path]: r.ok
            ? { listing: r.value, loading: false, error: null }
            : { listing: null, loading: false, error: r.error.message },
        }));
      });
    },
    [api],
  );

  // Ao trocar de raiz (ou recarregar), esquece as pastas carregadas e abre a raiz.
  useEffect(() => {
    if (rootPath === null) {
      setDirs({});
      setExpanded({});
      setStatus({});
      return;
    }
    setDirs({});
    setExpanded({ [rootPath]: true });
    loadDir(rootPath);
    let alive = true;
    void api.files.status(rootPath).then((r) => {
      if (alive && r.ok) setStatus(r.value);
    });
    return () => {
      alive = false;
    };
  }, [rootPath, reloadKey, loadDir, api]);

  const toggle = (entry: FileEntry) => {
    const open = expanded[entry.path] !== true;
    setExpanded({ ...expanded, [entry.path]: open });
    const state = dirs[entry.path];
    if (open && state?.listing == null && state?.loading !== true) loadDir(entry.path);
  };

  const renderDir = (path: string, depth: number) => {
    const state = dirs[path] ?? EMPTY_DIR;
    if (state.loading) {
      return (
        <div className="files-message" style={{ paddingLeft: 12 + depth * 12 }}>
          Carregando…
        </div>
      );
    }
    if (state.error !== null) {
      return (
        <div className="files-message error" style={{ paddingLeft: 12 + depth * 12 }}>
          {state.error}
        </div>
      );
    }
    const listing = state.listing;
    if (listing === null) return null;
    return (
      <>
        {listing.entries.map((entry) =>
          entry.kind === 'directory' ? (
            <div key={entry.path}>
              <button
                type="button"
                className="files-row"
                style={{ paddingLeft: 8 + depth * 12 }}
                aria-expanded={expanded[entry.path] === true}
                onClick={() => toggle(entry)}
                data-testid={`dir-${entry.name}`}
              >
                <span className="files-caret">{expanded[entry.path] ? '▾' : '▸'}</span>
                <span className="files-name">{entry.name}</span>
                {rootPath !== null && statusForDir(status, rootPath, entry.path) !== null ? (
                  <StatusBadge change={statusForDir(status, rootPath, entry.path) as FileChange} />
                ) : null}
              </button>
              {expanded[entry.path] ? renderDir(entry.path, depth + 1) : null}
            </div>
          ) : (
            <button
              key={entry.path}
              type="button"
              className="files-row"
              style={{ paddingLeft: 20 + depth * 12 }}
              title={entry.path}
              onClick={() => onOpenFile?.(entry.path)}
              data-testid={`file-${entry.name}`}
            >
              <span className="files-icon" aria-hidden="true">
                ▤
              </span>
              <span className="files-name">{entry.name}</span>
              {rootPath !== null && statusForPath(status, rootPath, entry.path) !== null ? (
                <StatusBadge change={statusForPath(status, rootPath, entry.path) as FileChange} />
              ) : null}
              <span className="files-size">{formatSize(entry.size)}</span>
            </button>
          ),
        )}
        {listing.truncated ? (
          <div className="files-message" style={{ paddingLeft: 12 + depth * 12 }}>
            Pasta com muitas entradas: mostrando as primeiras.
          </div>
        ) : null}
      </>
    );
  };

  const current = roots.find((root) => root.path === rootPath) ?? null;

  return (
    <div className="files">
      <div className="files-toolbar">
        <select
          className="files-root"
          aria-label="Raiz do explorador"
          value={rootPath ?? ''}
          onChange={(e) => setRootPath(e.target.value || null)}
          disabled={roots.length === 0}
        >
          {roots.length === 0 ? <option value="">Nenhuma pasta aberta</option> : null}
          {roots.map((root) => (
            <option key={root.path} value={root.path} disabled={root.available === false}>
              {rootOptionLabel(root)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="icon-button"
          title="Recarregar"
          aria-label="Recarregar"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          ⟳
        </button>
        {onShowWorkspaces ? (
          <button
            type="button"
            className="icon-button"
            title="Voltar aos workspaces"
            aria-label="Voltar aos workspaces"
            onClick={onShowWorkspaces}
          >
            ‹
          </button>
        ) : null}
      </div>
      {current ? (
        <div className="files-context">
          {current.primary ? (
            <span className="files-primary" title="Pasta principal do workspace: os terminais abrem nela">
              principal
            </span>
          ) : null}
          {current.path}
        </div>
      ) : null}
      <div className="files-tree" data-testid="files-tree">
        {rootPath === null ? (
          <p className="files-message">
            Abra uma pasta como workspace para navegar pelos arquivos.
          </p>
        ) : (
          renderDir(rootPath, 0)
        )}
      </div>
    </div>
  );
}
